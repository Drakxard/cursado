import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import type { LibraryManifest } from '../lib/workspace-library.ts'

test('publisher skips unchanged content, excludes secrets, retries interrupted commits and publishes deletions', async () => {
  const values = new Map<string, File>(), directories = new Set(['']), uploaded = new Map<string, Uint8Array>()
  let modified = Date.now(), uploads = 0, commits = 0, failCommit = false, failTransfer = true, current: LibraryManifest | null = null
  let legacyReads = 0, reused = 0
  let recoveryFailure: 'network' | 'space' | null = 'network'
  let forbiddenTransfer = false
  const oldFiles: Record<string, string> = { 'r2/calculo/semana-1/lunes/old-a.pdf': 'Earlier A', 'r2/calculo/semana-1/lunes/old-b.pdf': 'Recovered old PDF' }
  const missing = () => new DOMException('Not found', 'NotFoundError')
  function directory(prefix: string): unknown {
    const dir = {
      kind: 'directory', name: prefix || 'Biblioteca',
      async getDirectoryHandle(name: string, options?: { create?: boolean }) { const path = prefix ? `${prefix}/${name}` : name; if (!directories.has(path) && !options?.create) throw missing(); directories.add(path); return directory(path) },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const path = prefix ? `${prefix}/${name}` : name
        if (!values.has(path)) { if (!options?.create) throw missing(); values.set(path, new File([], name, { lastModified: ++modified })) }
        return { getFile: async () => values.get(path), createWritable: async () => {
          const chunks: BlobPart[] = [], sink = { async write(value: BlobPart) { if (path.endsWith('old-b.pdf') && recoveryFailure === 'space') throw new DOMException('Disk full', 'QuotaExceededError'); chunks.push(value) }, async close() { values.set(path, new File(chunks, name, { lastModified: ++modified })) } }
          return Object.assign(new WritableStream(sink), sink)
        } }
      },
      async *entries() {
        const start = prefix ? `${prefix}/` : ''
        for (const path of directories) if (path !== prefix && path.startsWith(start) && !path.slice(start.length).includes('/')) yield [path.slice(start.length), directory(path)]
        for (const path of values.keys()) if (path.startsWith(start) && !path.slice(start.length).includes('/')) yield [path.slice(start.length), { kind: 'file', ...await dir.getFileHandle(path.slice(start.length)) }]
      },
    }
    return dir
  }
  function put(path: string, value: BlobPart) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/')); values.set(path, new File([value], parts.at(-1)!, { lastModified: ++modified })) }
  put('User.Services', 'DO NOT PUBLISH MY CREDENTIALS')
  put('manifests/drive-sync.json', '{"credentials":"private"}')
  put('manifests/materials/calculo/week-1.json', JSON.stringify({ materials: [{ id: 1, subject_id: 'calculo', week_number: 1, material_type: 'theory', file_name: 'PDF', drive_file_id: 'workspace://teoria/calculo/semana-1/a.pdf' }] }))
  put('teoria/calculo/semana-1/a.pdf', 'PDF fixture one')
  put('manifests/entries/calculo/week-1.json', JSON.stringify({ entries: [{ id: 1, subject_id: 'calculo', week_number: 1, transcript_text: 'Apunte importante', is_featured: true }] }))
  const root = directory('')
  const bundle = await build({ entryPoints: ['lib/client/workspace-library.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'workspace-handles', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/local-workspace-client$/ }, () => ({ path: 'workspace', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export function getReadyInscreenConfigToken(){return "owner"} export function getReadyWorkspaceHandle(){} export async function loadServicesFile(){} export async function loadWorkspaceHandle(){} export async function queryWorkspacePermission(){return "granted"} export function setReadyInscreenConfigToken(){}' }))
  } }] })
  const module = { exports: {} as { publishLibrary: (root: unknown) => Promise<LibraryManifest> } }
  const originalFetch = globalThis.fetch, originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), originalIndexed = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  let lastProgress: { error?: string; help?: string } = {}
  window.addEventListener('cursado-library-progress', event => { lastProgress = (event as CustomEvent).detail })
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { databases: async () => [] } })
  globalThis.fetch = async (input, options) => {
    const url = String(input)
    if (url.startsWith('https://upload.fixture/')) {
      if (failTransfer) throw new TypeError('Failed to fetch')
      if (forbiddenTransfer) return new Response('', { status: 403 })
      const hash = url.split('/').at(-1)!, bytes = new Uint8Array(await (options!.body as Blob).arrayBuffer())
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
      uploaded.set(hash, bytes); uploads++; return new Response('', { status: 200 })
    }
    const action = url.split('/workspace/')[1].split('?')[0], body = options?.body ? JSON.parse(String(options.body)) : {}
    if (action === 'legacy/catalog') {
      legacyReads++
      return Response.json({ documents: [{ path: 'manifests/materials/calculo/week-1.json', data: { version: 1, subjectId: 'calculo', weekNumber: 1, materials: Object.keys(oldFiles).map((key, index) => ({ id: index + 1, subject_id: 'calculo', week_number: 1, order_index: index + 4, material_type: 'theory', file_name: `Old ${index + 1}`, drive_file_id: `workspace://teoria/${key.slice(3)}` })) } }], files: Object.entries(oldFiles).map(([key, text]) => ({ key, path: `teoria/${key.slice(3)}`, size: text.length, mime: 'application/pdf' })) })
    }
    if (action === 'legacy/object') return recoveryFailure === 'network' ? new Response(new ReadableStream({ start(controller) { controller.error(new Error('Interrupted download')) } })) : new Response(oldFiles[new URL(url, 'https://cursado.test').searchParams.get('key')!])
    if (action === 'upload/diagnose') return Response.json(forbiddenTransfer ? { problem: 'authorization', message: 'R2 rechazó la subida (SignatureDoesNotMatch).' } : { problem: 'cors', message: 'La clave permite subir, pero hay un bloqueo CORS.' })
    if (action === 'status') return Response.json({ manifest: current })
    if (action === 'cors') return Response.json({ ok: true, corsManaged: false })
    if (action === 'upload') {
      const previous = oldFiles[body.previousKey]
      if (previous && createHash('sha256').update(previous).digest('hex') === body.hash) { uploaded.set(body.hash, new TextEncoder().encode(previous)); reused++; return Response.json({ exists: true, reused: true }) }
      return Response.json(uploaded.has(body.hash) ? { exists: true } : { uploadUrl: `https://upload.fixture/${body.hash}`, headers: {} })
    }
    if (action === 'publish') {
      if (failCommit) return Response.json({ error: 'Interrupted commit' }, { status: 503 })
      for (const file of body.manifest.files) assert.equal(uploaded.get(file.hash)?.length, file.size)
      assert.equal(body.previousRevision, current?.revision || null)
      current = body.manifest; commits++; return Response.json({ ok: true })
    }
    throw new Error(`Unexpected action ${action}`)
  }
  try {
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
    const publish = module.exports.publishLibrary
    await assert.rejects(publish(root), /Se interrumpió la recuperación/)
    assert.equal(commits, 0)
    recoveryFailure = 'space'
    await assert.rejects(publish(root), /No hay espacio suficiente/)
    recoveryFailure = null
    await assert.rejects(publish(root), /bloqueo CORS/)
    assert.equal(lastProgress.help, 'cors')
    assert.equal(commits, 0); assert.equal(current, null)
    failTransfer = false
    const first = await publish(root), count = uploads
    assert.equal(reused, 1); assert.equal(legacyReads, 3)
    assert.equal(await values.get('teoria/calculo/semana-1/a.pdf')!.text(), 'PDF fixture one')
    assert.equal(await values.get('teoria/calculo/semana-1/lunes/old-b.pdf')!.text(), 'Recovered old PDF')
    const restored = JSON.parse(await values.get('manifests/materials/calculo/week-1.json')!.text())
    assert.equal(restored.materials.find((row: { id: number }) => row.id === 2).order_index, 5)
    assert.equal(first.files.some(f => /User.Services|drive-sync/.test(f.path)), false)
    assert.equal(first.items.find(i => i.id === 'material:1')?.fileId, first.files.find(f => f.path.endsWith('a.pdf'))?.id)
    assert.equal(first.items.find(i => i.id === 'entry:1')?.important, true)
    assert.equal((await publish(root)).revision, first.revision)
    assert.equal(uploads, count); assert.equal(commits, 1)
    // Exercises bounded-memory hashing for a larger file as well as retry reuse.
    put('teoria/calculo/semana-1/a.pdf', new Uint8Array(8 * 1024 * 1024 + 1).fill(65))
    forbiddenTransfer = true
    await assert.rejects(publish(root), /SignatureDoesNotMatch/)
    assert.equal(lastProgress.help, undefined)
    assert.equal(current!.revision, first.revision)
    forbiddenTransfer = false
    failCommit = true
    await assert.rejects(publish(root), /Interrupted commit/)
    assert.equal(current!.revision, first.revision)
    const afterFailure = uploads; failCommit = false
    const second = await publish(root)
    assert.notEqual(second.revision, first.revision); assert.equal(uploads, afterFailure)
    values.delete('teoria/calculo/semana-1/a.pdf')
    const third = await publish(root)
    assert.equal(third.files.some(f => f.path.endsWith('a.pdf')), false)
    assert.equal(third.items.find(i => i.id === 'material:1')?.fileId, undefined)
    assert.equal(legacyReads, 3)
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (originalIndexed) Object.defineProperty(globalThis, 'indexedDB', originalIndexed); else Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})
