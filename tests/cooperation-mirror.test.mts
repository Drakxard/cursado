import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { authRuntime } from './cloudflare-runtime.mjs'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

const bundled = await build({ entryPoints: ['lib/client/cooperation.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'workspace-fixture', setup(builder) {
  builder.onResolve({ filter: /local-workspace-client\.ts$/ }, () => ({ path: 'workspace', namespace: 'test' }))
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const getReadyWorkspaceHandle=()=>globalThis.__cooperationRoot;export const loadWorkspaceHandle=async()=>globalThis.__cooperationRoot;export const queryWorkspacePermission=async()=>"granted"' }))
} }] })

test('local mirrors download exact files, isolate subjects, synchronize independent offline edits, and persist deletion choices', async t => {
  const backend = authRuntime(); t.after(() => backend.close())
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window, originalStorage = globalThis.localStorage, originalSocket = globalThis.WebSocket
  const storage = new Map<string, string>()
  globalThis.window = new EventTarget() as any
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } as any
  globalThis.WebSocket = class { close() {} } as any
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
  t.after(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; globalThis.localStorage = originalStorage; globalThis.WebSocket = originalSocket })
  const actors: any[] = []
  for (const name of ['A', 'B', 'C']) {
    const response = await backend.request('/api/auth/guest', { body: { name, password: 'test-only' } })
    const cookie = response.headers.get('set-cookie')!.split(';')[0]
    const fs = memoryWorkspace()
    const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}#${name}`)
    actors.push({ name, cookie, fs, client })
  }
  const [a, b, c] = actors
  async function use(actor: any, action: () => Promise<any>) {
    ;(globalThis as any).__cooperationRoot = actor.fs.root
    globalThis.fetch = async (url, options = {}) => {
      const request = new Request(`https://backend.test${String(url).replace(/^\/pizarra/, '')}`, { ...options, headers: { ...options.headers as any, Cookie: actor.cookie, Origin: backend.env.CURSADO_ORIGIN } })
      if (options.method === 'PUT') actor.uploads = (actor.uploads || 0) + 1
      const response = await backend.fetch(request)
      if (actor.corruptDownload && String(url).includes('/files/') && !options.method) { actor.corruptDownload = false; return new Response('corrupted bytes', { status: 200 }) }
      return response
    }
    return action()
  }
  await a.fs.put('manifests/subject-catalog.json', { version: 2, subjects: { algebra: { id: 'algebra', name: 'Álgebra', storageKey: 'Algebra' } } })
  await a.fs.put('manifests/materials/Algebra/week-1.json', { version: 1, subjectId: 'Algebra', weekNumber: 1, materials: [{ id: 100, subject_id: 'Algebra', file_name: 'Uno.pdf', drive_file_id: 'workspace://teoria/Algebra/uno.pdf' }] })
  await a.fs.put('teoria/Algebra/uno.pdf', new Blob(['test pdf'], { type: 'application/pdf' }))
  await a.fs.put('teoria/Private/secret.pdf', 'private')
  await a.fs.put('User.Services', 'secret credentials')
  const image = 'data:image/png;base64,aW1hZ2U='
  await a.fs.put('progreso/pizarras/study-test.json', { version: 1, boardId: 'study-test', cooperationSubjectId: 'algebra', name: 'Álgebra - Teoría', content: { strokes: [{ id: 'stroke-a', points: [{ x: 1, y: 2 }] }], texts: [], media: [{ id: 'media-a', assetId: 'asset-a' }], shapes: [], camera: { x: 100, y: 100, zoom: 2 } }, assets: { 'asset-a': image } })
  const largeNotes = '📚Álgebra'.repeat(40000)
  await a.fs.put('manifests/subject-voice/algebra/workspace.json', { version: 1, subjectId: 'algebra', notes: largeNotes, groups: [{ id: 'voice-group', name: 'Conjunto', color: '#b2f2bb', images: [{ id: 'voice-image', name: 'Foto', path: 'subject-voice/images/algebra/foto.png' }] }] })
  await a.fs.put('subject-voice/images/algebra/foto.png', new Blob(['voice image'], { type: 'image/png' }))
  await a.fs.put('manifests/sintesis/algebra/semana-1/workspace.json', { version: 1, workspace: { version: 2, revision: 1, defaultScale: 1, document: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'image', attrs: { src: 'synthesis-local-image:synthesis-image' } }] }, layout: {} }, r2: { etag: null, baseline: null } })
  await a.fs.put('sintesis/images/synthesis-image.png', new Blob(['synthesis image'], { type: 'image/png' }))
  const groupId = await use(a, () => a.client.createCooperationGroup('B,C'))
  const binding = await use(a, () => a.client.shareCooperationSphere(groupId, { id: 'algebra', name: 'Álgebra', color: '#2563eb' }))
  assert.ok(binding.id)
  for (const actor of [b, c]) {
    await actor.fs.put('manifests/subject-catalog.json', { version: 2, subjects: { algebra: { id: 'algebra', name: 'Personal', storageKey: 'Personal' } } })
    await use(actor, () => actor.client.refreshCooperation())
    const sphere = actor.client.cooperationState().groups[0].spheres[0]
    if (actor === b) {
      actor.corruptDownload = true
      await assert.rejects(use(actor, () => actor.client.acceptCooperationSphere(sphere)), /verificación/)
      assert.equal(actor.client.cooperationState().mirrors[binding.id].downloading, true)
      assert.ok(actor.client.cooperationState().mirrors[binding.id].incoming)
      assert.equal((await actor.fs.json('manifests/subject-catalog.json')).subjects[`coop-${binding.id}`], undefined)
    }
    await use(actor, () => actor.client.acceptCooperationSphere(sphere))
    assert.equal(actor.client.cooperationState().mirrors[binding.id].error, undefined)
    assert.equal(actor.uploads || 0, 0)
    const path = `teoria/Cooperativo-${binding.id}/uno.pdf`
    assert.equal(await actor.fs.files.get(path).text(), 'test pdf')
    assert.equal(actor.fs.files.has('User.Services'), false)
    assert.equal(actor.fs.files.has('teoria/Private/secret.pdf'), false)
    assert.equal((await actor.fs.json('manifests/subject-catalog.json')).subjects.algebra.name, 'Personal')
    const board = await actor.fs.json(`progreso/pizarras/study-test-${binding.id.slice(0, 8)}.json`)
    assert.equal(board.assets['asset-a'], image)
    assert.equal(board.content.camera.zoom, 1)
    assert.equal(await actor.fs.files.get(`subject-voice/images/coop-${binding.id}/foto.png`).text(), 'voice image')
    assert.equal((await actor.fs.json(`manifests/subject-voice/coop-${binding.id}/workspace.json`)).notes, largeNotes)
    const synthesis = await actor.fs.json(`manifests/sintesis/coop-${binding.id}/semana-1/workspace.json`)
    assert.ok(synthesis.r2)
    assert.ok(JSON.stringify(synthesis).includes(`synthesis-local-image:synthesis-image-${binding.id.slice(0, 8)}`))
    assert.equal(await actor.fs.files.get(`sintesis/images/synthesis-image-${binding.id.slice(0, 8)}.png`).text(), 'synthesis image')
  }
  const pathA = 'manifests/materials/Algebra/week-1.json', pathB = `manifests/materials/Cooperativo-${binding.id}/week-1.json`
  const localA = await a.fs.json(pathA), localB = await b.fs.json(pathB)
  localA.materials.push({ id: 101, file_name: 'Dos.pdf' }); localB.materials.push({ id: 102, file_name: 'Tres.pdf' })
  await a.fs.put(pathA, localA); await b.fs.put(pathB, localB)
  await use(a, () => a.client.synchronizeCooperation()); await use(b, () => b.client.synchronizeCooperation()); await use(a, () => a.client.synchronizeCooperation())
  assert.equal((await a.fs.json(pathA)).materials.length, 3)
  assert.equal((await b.fs.json(pathB)).materials.length, 3)
  const deleted = await a.fs.json(pathA); deleted.materials = deleted.materials.filter(row => row.id !== 100)
  await a.fs.put(pathA, deleted); await use(a, () => a.client.synchronizeCooperation()); await use(b, () => b.client.synchronizeCooperation())
  let pending = b.client.cooperationState().deletions.find(d => d.selector.includes('@100'))
  assert.ok(pending); assert.equal(pending.decision, 'wait')
  const localIdB = b.client.cooperationState().mirrors[binding.id].binding.numberAliases['100']
  assert.ok((await b.fs.json(pathB)).materials.some(row => row.id === localIdB))
  await use(b, () => b.client.decideCooperationDeletion(pending.id, 'keep'))
  await use(b, () => b.client.synchronizeCooperation()); await use(a, () => a.client.synchronizeCooperation())
  assert.ok((await b.fs.json(pathB)).materials.some(row => row.id === localIdB))
  assert.equal((await a.fs.json(pathA)).materials.some(row => row.id === 100), false)
  await use(c, () => c.client.synchronizeCooperation())
  pending = c.client.cooperationState().deletions.find(d => d.selector.includes('@100'))
  await use(c, () => c.client.decideCooperationDeletion(pending.id, 'delete'))
  const pathC = `manifests/materials/Cooperativo-${binding.id}/week-1.json`
  const localIdC = c.client.cooperationState().mirrors[binding.id].binding.numberAliases['100']
  assert.equal((await c.fs.json(pathC)).materials.some(row => row.id === localIdC), false)
  const persisted = await c.fs.json(`.cooperation/${c.client.cooperationState().userId}/state.json`)
  assert.equal(persisted.deletions.find(d => d.id === pending.id).decision, 'delete')
  assert.equal(c.fs.files.has(`teoria/Cooperativo-${binding.id}/uno.pdf`), false)
  // Local confirmation must not turn backing-file cleanup into another deletion.
  await use(c, () => c.client.synchronizeCooperation())
  await use(a, () => a.client.synchronizeCooperation())
  await use(b, () => b.client.synchronizeCooperation())
  assert.equal(a.client.cooperationState().deletions.length, 0)
  assert.equal(b.client.cooperationState().deletions.some(d => d.decision === 'wait'), false)
  assert.equal(await b.fs.files.get(`teoria/Cooperativo-${binding.id}/uno.pdf`).text(), 'test pdf')
  // Emptying a whole week must not prevent a later upload to that week.
  a.fs.files.delete(pathA)
  await use(a, () => a.client.synchronizeCooperation())
  await a.fs.put(pathA, { ...localA, materials: [{ id: 104, file_name: 'Nuevo.pdf' }] })
  await use(a, () => a.client.synchronizeCooperation()); await use(c, () => c.client.synchronizeCooperation())
  assert.ok((await c.fs.json(pathC)).materials.some(row => row.file_name === 'Nuevo.pdf'))
})
