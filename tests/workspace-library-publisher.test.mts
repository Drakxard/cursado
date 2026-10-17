import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import type { LibraryManifest } from '../lib/workspace-library.ts'

test('publisher skips unchanged content, excludes secrets, retries interrupted commits and publishes deletions', async () => {
  const values = new Map<string, File>(), directories = new Set(['']), uploaded = new Map<string, Uint8Array>()
  let modified = Date.now(), uploads = 0, commits = 0, failCommit = false, failTransfer = true, current: LibraryManifest | null = null
  const missing = () => new DOMException('Not found', 'NotFoundError')
  function directory(prefix: string): unknown {
    const dir = {
      kind: 'directory', name: prefix || 'Biblioteca',
      async getDirectoryHandle(name: string, options?: { create?: boolean }) { const path = prefix ? `${prefix}/${name}` : name; if (!directories.has(path) && !options?.create) throw missing(); directories.add(path); return directory(path) },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const path = prefix ? `${prefix}/${name}` : name
        if (!values.has(path)) { if (!options?.create) throw missing(); values.set(path, new File([], name, { lastModified: ++modified })) }
        return { getFile: async () => values.get(path), createWritable: async () => ({ async write(value: BlobPart) { values.set(path, new File([value], name, { lastModified: ++modified })) }, async close() {}, async abort() {} }) }
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
      const hash = url.split('/').at(-1)!, bytes = new Uint8Array(await (options!.body as Blob).arrayBuffer())
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
      uploaded.set(hash, bytes); uploads++; return new Response('', { status: 200 })
    }
    const action = url.split('/workspace/')[1].split('?')[0], body = options?.body ? JSON.parse(String(options.body)) : {}
    if (action === 'status') return Response.json({ manifest: current })
    if (action === 'cors') return Response.json({ ok: true, corsManaged: false })
    if (action === 'upload') return Response.json(uploaded.has(body.hash) ? { exists: true } : { uploadUrl: `https://upload.fixture/${body.hash}`, headers: {} })
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
    await assert.rejects(publish(root), /Tu clave no permite configurar CORS automáticamente/)
    assert.equal(lastProgress.help, 'cors')
    assert.equal(commits, 0); assert.equal(current, null)
    failTransfer = false
    const first = await publish(root), count = uploads
    assert.equal(first.files.some(f => /User.Services|drive-sync/.test(f.path)), false)
    assert.equal(first.items.find(i => i.id === 'material:1')?.fileId, first.files.find(f => f.path.endsWith('a.pdf'))?.id)
    assert.equal(first.items.find(i => i.id === 'entry:1')?.important, true)
    assert.equal((await publish(root)).revision, first.revision)
    assert.equal(uploads, count); assert.equal(commits, 1)
    // Exercises bounded-memory hashing for a larger file as well as retry reuse.
    put('teoria/calculo/semana-1/a.pdf', new Uint8Array(8 * 1024 * 1024 + 1).fill(65))
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
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (originalIndexed) Object.defineProperty(globalThis, 'indexedDB', originalIndexed); else Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})
