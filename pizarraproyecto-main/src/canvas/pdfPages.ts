import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { mediaWork } from './imageCache'
import type { PreviewInput } from './imageCache'
import { imagePreviewStore } from './imagePreviewStore'
import type { PdfPart, PdfRegion } from './pdfLayout'

type Entry = { task?: PDFDocumentLoadingTask; document: Promise<PDFDocumentProxy>; ready?: boolean; active: number; used: number; timer?: ReturnType<typeof setTimeout> }
const whole = { x: 0, y: 0, width: 1, height: 1 }
export class PdfPages {
  private documents = new Map<string, Entry>()
  private tasks = new Set<RenderTask>()
  private pageJobs = new Map<string, Promise<unknown>>()
  private generation = 0
  private workerSrc: string
  constructor(workerSrc: string) { this.workerSrc = workerSrc }
  private drop(key: string, entry: Entry) {
    if (this.documents.get(key) === entry) this.documents.delete(key)
    clearTimeout(entry.timer)
    void entry.task?.destroy().catch(() => {})
  }
  private async use<T>(key: string, load: () => Promise<Blob | undefined>, signal: AbortSignal | undefined, work: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    const generation = this.generation
    let entry = this.documents.get(key)
    if (!entry) {
      for (const [id, previous] of [...this.documents].sort((a, b) => a[1].used - b[1].used)) {
        if (this.documents.size < 2) break
        if (!previous.active) this.drop(id, previous)
      }
      if (this.documents.size >= 2) throw new Error('Esperá a que termine la carga del PDF.')
      const created: Entry = { active: 0, used: Date.now(), document: Promise.resolve(null as unknown as PDFDocumentProxy) }
      created.document = (async () => {
        const blob = await load()
        if (!blob) throw new Error('No se encontró el PDF original.')
        const pdfjs = await import('pdfjs-dist')
        if (generation !== this.generation || this.documents.get(key)!==created) throw new DOMException('Pizarra cerrada', 'AbortError')
        pdfjs.GlobalWorkerOptions.workerSrc = this.workerSrc
        const data = new Uint8Array(await blob.arrayBuffer())
        if (generation !== this.generation || this.documents.get(key)!==created) throw new DOMException('Pizarra cerrada', 'AbortError')
        const task = pdfjs.getDocument({ data })
        created.task = task
        const password = new Promise<never>((_resolve, reject) => {
          task.onPassword = () => { reject(new Error('El PDF requiere contraseña. El acceso se conservó.')); void task.destroy().catch(() => {}) }
        })
        const document = await Promise.race([task.promise, password])
        created.ready = true
        return document
      })()
      entry = created; this.documents.set(key, entry)
    }
    const current = entry
    clearTimeout(current.timer); current.active++; current.used = Date.now()
    // Cancelling a viewport render must not reopen/decode the same original
    // during every pan. Only an unfinished document load needs destroying.
    const abort = () => { if (!current.ready && current.active === 1) this.drop(key, current) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const doc = await current.document
      signal?.throwIfAborted()
      if (generation !== this.generation) throw new DOMException('Pizarra cerrada', 'AbortError')
      return await work(doc)
    } catch (error) {
      if (current.active === 1 && (!current.ready || !signal?.aborted)) this.drop(key, current)
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      current.active--; current.used = Date.now()
      if (!current.active && this.documents.get(key) === current) current.timer = setTimeout(() => this.drop(key, current), 30000)
    }
  }
  async metadata(key: string, blob: Blob, signal: AbortSignal, progress: (page: number, count: number) => void) {
    return mediaWork(() => this.use(key, async () => blob, signal, async doc => {
      const pages: { width: number; height: number }[] = []
      for (let number = 1; number <= doc.numPages; number++) {
        signal.throwIfAborted(); progress(number, doc.numPages)
        const page = await doc.getPage(number)
        try {
          const view = page.getViewport({ scale: 1 })
          if(!Number.isFinite(view.width)||!Number.isFinite(view.height)||view.width<=0||view.height<=0)throw new Error(`La página ${number} del PDF no tiene un tamaño válido.`)
          pages.push({ width: view.width, height: view.height })
        }
        finally { page.cleanup() }
        if (number % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0))
      }
      return pages
    }))
  }
  /** Called within AdaptiveImageCache's shared slot; only regions requested by the viewport render. */
  async preview(part: PdfPart, width: number, height: number, load: () => Promise<Blob | undefined>, signal: AbortSignal): Promise<PreviewInput> {
    const cacheKey = JSON.stringify(['pdf-preview-v1', part.id, width, height])
    const cached = await imagePreviewStore.get(cacheKey)
    signal.throwIfAborted()
    if (cached) return cached
    const canvas = await this.render(part.scope, part.pageNumber, part.region, width, height, load, signal)
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo preparar la página PDF.')), 'image/png'))
      signal.throwIfAborted()
      await imagePreviewStore.put(cacheKey, { blob, width: canvas.width, height: canvas.height })
      signal.throwIfAborted()
      return { blob, width: canvas.width, height: canvas.height, decoded: { source: canvas, width: canvas.width, height: canvas.height, release: () => { canvas.width = canvas.height = 0 } } }
    } catch (error) { canvas.width = canvas.height = 0; throw error }
  }
  async capture(key: string, page: number, width: number, height: number, load: () => Promise<Blob | undefined>) {
    const generation = this.generation
    return mediaWork(async () => {
      if(generation!==this.generation)throw new DOMException('Pizarra cerrada','AbortError')
      const canvas = await this.render(key, page, whole, width, height, load)
      try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo capturar el PDF.')), 'image/png')) }
      finally { canvas.width = canvas.height = 0 }
    })
  }
  private async render(key: string, number: number, region: PdfRegion, width: number, height: number, load: () => Promise<Blob | undefined>, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const generation=this.generation
    const pageKey = JSON.stringify([key, number]), previous = this.pageJobs.get(pageKey) ?? Promise.resolve()
    const job = previous.catch(() => {}).then(() => {
      if(generation!==this.generation)throw new DOMException('Pizarra cerrada','AbortError')
      return this.use(key, load, signal, async doc => {
      const page = await doc.getPage(number), canvas = document.createElement('canvas')
      let render: RenderTask | undefined
      const abort = () => render?.cancel()
      try {
        signal?.throwIfAborted()
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(width / (base.width * region.width), height / (base.height * region.height))
        const viewport = page.getViewport({ scale })
        canvas.width = Math.max(1, Math.floor(viewport.width * region.width)); canvas.height = Math.max(1, Math.floor(viewport.height * region.height))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('No se pudo preparar la página PDF.')
        render = page.render({ canvas, canvasContext: context, viewport, transform: [1, 0, 0, 1, -viewport.width * region.x, -viewport.height * region.y], background: '#ffffff' })
        this.tasks.add(render); signal?.addEventListener('abort', abort, { once: true })
        await render.promise; signal?.throwIfAborted()
        return canvas
      } catch (error) { canvas.width = canvas.height = 0; throw error }
      finally { signal?.removeEventListener('abort', abort); if (render) this.tasks.delete(render); page.cleanup() }
      })
    })
    this.pageJobs.set(pageKey, job)
    try { return await job }
    finally { if (this.pageJobs.get(pageKey) === job) this.pageJobs.delete(pageKey) }
  }
  clear() {
    this.generation++
    for (const task of this.tasks) task.cancel()
    for (const [key, entry] of this.documents) this.drop(key, entry)
  }
}
