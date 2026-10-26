import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ opened: [] as string[], closed: [] as string[], renders: [] as { page: number; transform: number[] }[], pause: false, finish: [] as (() => void)[] }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: ({ data }: { data: Uint8Array }) => {
  const key = new TextDecoder().decode(data)
  state.opened.push(key)
  let destroyed = false
  return { destroy: async () => { if (!destroyed) state.closed.push(key); destroyed = true }, promise: key==='protected'?new Promise(()=>{}):Promise.resolve({ numPages: 3, getPage: async (page: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), cleanup() {},
    render: ({ transform }: { transform: number[] }) => {
      state.renders.push({ page, transform })
      let reject!: (reason: unknown) => void
      const promise = state.pause ? new Promise<void>((resolve, no) => { reject = no; state.finish.push(resolve) }) : Promise.resolve()
      return { promise, cancel: () => reject?.(new DOMException('Cancelled', 'AbortError')) }
    },
  }) }),set onPassword(handler:()=>void){if(key==='protected')queueMicrotask(handler)} }
} }))
vi.mock('../src/canvas/imagePreviewStore', () => ({ imagePreviewStore: { get: async () => undefined, put: async () => {} } }))
import { PdfPages } from '../src/canvas/pdfPages'
import type { PdfPart } from '../src/canvas/pdfLayout'
import { AdaptiveImageCache, IMAGE_CACHE_BYTES } from '../src/canvas/imageCache'

const managers: PdfPages[] = []
function manager() {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['PNG'], { type: 'image/png' })) }) })
  const value = new PdfPages('worker.mjs'); managers.push(value); return value
}
const part = (pageNumber = 1, scope = 'a'): PdfPart => ({ id: `page-${pageNumber}`, assetId: scope, scope, pageNumber, width: 600, height: 800, region: { x: 0, y: 0, width: 1, height: 1 } })
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
afterEach(() => {
  managers.splice(0).forEach(value => value.clear())
  state.opened = []; state.closed = []; state.renders = []; state.pause = false; state.finish = []
  vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('PDF original lifecycle and page rendering', () => {
  it('rejects protected originals without leaving a pending password prompt or rendering pages',async()=>{
    const pdf=manager()
    await expect(pdf.metadata('protected',new Blob(['protected']),new AbortController().signal,()=>{})).rejects.toThrow('contraseña')
    expect(state.renders).toEqual([])
    expect(state.closed).toEqual(['protected'])
  })
  it('reads metadata without rasterizing pages and evicts documents by idle time and a two-document limit', async () => {
    vi.useFakeTimers()
    const pdf = manager(), signal = new AbortController().signal
    expect(await pdf.metadata('a', new Blob(['a']), signal, () => {})).toHaveLength(3)
    expect(state.renders).toHaveLength(0)
    for (const key of ['b', 'c']) await pdf.metadata(key, new Blob([key]), signal, () => {})
    expect(state.opened).toEqual(['a', 'b', 'c'])
    expect(state.closed).toContain('a')
    await vi.advanceTimersByTimeAsync(30001)
    expect(state.closed.sort()).toEqual(['a', 'b', 'c'])
  })
  it('renders requested pages and clipped regions, releases retained pixels, and uses one original', async () => {
    const pdf = manager(), signal = new AbortController().signal
    const first = await pdf.preview(part(1), 600, 800, async () => new Blob(['a']), signal)
    const tile = { ...part(2), region: { x: .5, y: .5, width: .25, height: .25 } }
    const second = await pdf.preview(tile, 300, 400, async () => { throw new Error('Original must be reused') }, signal)
    expect(state.opened).toEqual(['a'])
    expect(state.renders.map(item => item.page)).toEqual([1, 2])
    expect(state.renders[1].transform.slice(4)).toEqual([-600, -800])
    if (first instanceof Blob || second instanceof Blob) throw new Error('Expected drawable previews')
    const source = first.decoded!.source as HTMLCanvasElement
    first.decoded!.release(); second.decoded!.release()
    expect(source.width).toBe(0)
  })
  it('shares the retained pixel budget, cancels hidden renders and prevents late work after closing', async () => {
    const pdf = manager()
    state.pause = true
    const requests = [part(1), part(2), part(3)]
    const byId = new Map(requests.map(request => [request.id, request]))
    const cache = new AdaptiveImageCache((id, request, signal) => pdf.preview(byId.get(id)!, request.width, request.height, async () => new Blob(['a']), signal), () => {})
    cache.reconcile(requests)
    // Drain async module/Blob steps as well as promise chains.
    for (let i = 0; i < 20 && !state.renders.length; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(state.renders.length).toBeGreaterThan(0)
    expect(cache.pending).toBeLessThanOrEqual(2)
    cache.reconcile([])
    state.finish.splice(0).forEach(finish => finish())
    await settle()
    cache.clear(); pdf.clear()
    expect(cache.bytes).toBeLessThanOrEqual(IMAGE_CACHE_BYTES)
    expect(cache.size).toBe(0)
  })
  it('does not create a worker when an original finishes loading after cancellation', async () => {
    const pdf=manager(),controller=new AbortController()
    let finish!:(blob:Blob)=>void
    const pending=pdf.preview(part(),600,800,()=>new Promise(resolve=>{finish=resolve}),controller.signal)
    await settle();controller.abort();finish(new Blob(['too late']))
    await expect(pending).rejects.toMatchObject({name:'AbortError'})
    expect(state.opened).toEqual([])
  })
  it('keeps a loaded original when a viewport render is cancelled, and retains only budgeted pixels', async () => {
    const pdf=manager(),controller=new AbortController()
    state.pause=true
    const pending=pdf.preview(part(),600,800,async()=>new Blob(['a']),controller.signal)
    for(let i=0;i<20&&!state.renders.length;i++)await new Promise(resolve=>setTimeout(resolve,0))
    controller.abort()
    await expect(pending).rejects.toMatchObject({name:'AbortError'})
    state.pause=false
    const requests=[part(1),part(2),part(3)].map(p=>({...p,width:6000,height:8000})),byId=new Map(requests.map(p=>[p.id,p]))
    const cache=new AdaptiveImageCache((id,request,signal)=>pdf.preview(byId.get(id)!,request.width,request.height,async()=>new Blob(['a']),signal),()=>{})
    cache.reconcile(requests)
    for(let i=0;i<50&&cache.size<3;i++)await new Promise(resolve=>setTimeout(resolve,0))
    expect(cache.size).toBe(3)
    expect(state.opened).toEqual(['a'])
    expect(cache.bytes).toBeGreaterThan(0)
    expect(cache.bytes).toBeLessThanOrEqual(IMAGE_CACHE_BYTES)
    const canvas=cache.get('page-1') as HTMLCanvasElement
    cache.clear();expect(canvas.width).toBe(0)
  })
})
