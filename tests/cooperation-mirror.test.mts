import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { authRuntime } from './cloudflare-runtime.mjs'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

const bundled = await build({ entryPoints: ['lib/client/cooperation.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'workspace-fixture', setup(builder) {
  builder.onResolve({ filter: /local-workspace-client\.ts$/ }, () => ({ path: 'workspace', namespace: 'test' }))
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const getReadyWorkspaceHandle=()=>globalThis.__cooperationRoot;export const loadWorkspaceHandle=async()=>globalThis.__cooperationRoot;export const queryWorkspacePermission=async()=>"granted";export const getReadyInscreenConfigToken=()=>"";export const loadServicesFile=async()=>null' }))
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
  for (const name of ['A', 'B', 'C', 'D']) {
    const response = await backend.request('/api/auth/guest', { body: { name, password: 'test-only' } })
    const cookie = response.headers.get('set-cookie')!.split(';')[0]
    const fs = memoryWorkspace()
    const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}#${name}`)
    actors.push({ name, cookie, fs, client })
  }
  const [a, b, c, d] = actors
  async function use(actor: any, action: () => Promise<any>) {
    ;(globalThis as any).__cooperationRoot = actor.fs.root
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) === '/pizarra/upload-session') {
        const { sphereId, hash, size, mime } = JSON.parse(String(options.body))
        const response = await backend.request(`/api/cooperation/spheres/${sphereId}/files/${hash}`, { cookie: actor.cookie, body: { size } })
        if (!response.ok) return response
        return Response.json({ uploadUrl: `https://r2.test/api/cooperation/spheres/${sphereId}/files/${hash}`, headers: { 'Content-Type': mime } })
      }
      if (String(url).startsWith('https://r2.test/')) url = new URL(String(url)).pathname
      const request = new Request(`https://backend.test${String(url).replace(/^\/pizarra/, '')}`, { ...options, headers: { ...options.headers as any, Cookie: actor.cookie, Origin: backend.env.CURSADO_ORIGIN } })
      if (options.method === 'PUT') {
        actor.uploads = (actor.uploads || 0) + 1
        if (actor.beforeUpload) await actor.beforeUpload(String(url))
      }
      if (String(url).includes('/files/') && !options.method) actor.downloads = (actor.downloads || 0) + 1
      const response = await backend.fetch(request)
      if (actor.corruptDownload && String(url).includes('/files/') && !options.method) { actor.corruptDownload = false; return new Response('corrupted bytes', { status: 200 }) }
      return response
    }
    return action()
  }
  await a.fs.put('manifests/subject-catalog.json', { version: 2, subjects: { algebra: { id: 'algebra', name: 'Álgebra', storageKey: 'Algebra' } } })
  await a.fs.put('manifests/materials/Algebra/week-1.json', { version: 1, subjectId: 'Algebra', weekNumber: 1, materials: [{ id: 100, subject_id: 'Algebra', file_name: 'Uno.pdf', drive_file_id: 'workspace://teoria/Algebra/uno.pdf' }] })
  await a.fs.put('teoria/Algebra/uno.pdf', new Blob(['test pdf'], { type: 'application/pdf' }))
  // A full subject exceeds a single 200-resource operation. Metadata must drain
  // before the first file transfer, rather than disappearing behind that upload.
  for (let week = 2; week <= 205; week++) await a.fs.put(`manifests/materials/Algebra/week-${week}.json`, { version: 1, subjectId: 'Algebra', weekNumber: week, materials: [] })
  await a.fs.put('teoria/Private/secret.pdf', 'private')
  await a.fs.put('User.Services', 'secret credentials')
  const image = 'data:image/png;base64,aW1hZ2U='
  const audio = 'data:audio/webm;codecs=opus;base64,YXVkaW8='
  const reviewMarker={id:'review-one',visualType:'review-marker',kind:'circle',x:300,y:400,width:56,height:56,color:'#202020',strokeWidth:3.5}
  await a.fs.put('progreso/pizarras/study-test.json', { version: 1, boardId: 'study-test', cooperationSubjectId: 'algebra', name: 'Álgebra - Teoría', content: { strokes: [{ id: 'stroke-a', points: [{ x: 1, y: 2 }] }], texts: [], media: [{ id: 'media-a', assetId: 'asset-a' },{id:'audio-note',assetId:'audio-asset',kind:'audio',mimeType:'audio/webm;codecs=opus',durationMs:1000,x:40,y:50,width:56,height:56}], shapes: [reviewMarker], camera: { x: 100, y: 100, zoom: 2 } }, assets: { 'asset-a': image, 'audio-asset': audio } })
  const largeNotes = '📚Álgebra'.repeat(40000)
  await a.fs.put('manifests/subject-voice/algebra/workspace.json', { version: 1, subjectId: 'algebra', notes: largeNotes, groups: [{ id: 'voice-group', name: 'Conjunto', color: '#b2f2bb', images: [{ id: 'voice-image', name: 'Foto', path: 'subject-voice/images/algebra/foto.png' }] }] })
  await a.fs.put('subject-voice/images/algebra/foto.png', new Blob(['voice image'], { type: 'image/png' }))
  await a.fs.put('manifests/sintesis/algebra/semana-1/workspace.json', { version: 1, workspace: { version: 2, revision: 1, defaultScale: 1, document: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'image', attrs: { src: 'synthesis-local-image:synthesis-image' } }] }, layout: {} }, r2: { etag: null, baseline: null } })
  await a.fs.put('sintesis/images/synthesis-image.png', new Blob(['synthesis image'], { type: 'image/png' }))
  const groupId = await use(a, () => a.client.createCooperationGroup('B,C,D'))
  let checkedPublication = false
  a.beforeUpload = async () => {
    if (checkedPublication) return
    const groups = await (await backend.request('/api/cooperation/groups', { cookie: b.cookie })).json()
    const pendingSphere = groups.groups[0].spheres[0]
    assert.equal(pendingSphere.ready, true)
    const snapshot = await backend.env.CONTENT_ROOMS.getByName(pendingSphere.id).snapshot()
    assert.ok(snapshot.resources['sphere.json'])
    assert.ok(snapshot.resources['manifests/materials/Algebra/week-205.json'])
    assert.equal(Object.values(snapshot.resources).some((r: any) => r.blob), false)
    // Refreshing invitations during an active upload must not wait for that upload.
    let timer: ReturnType<typeof setTimeout>
    try {
      await Promise.race([a.client.refreshCooperation(), new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Discovery blocked by upload')),1500)})])
    } finally { clearTimeout(timer!) }
    checkedPublication = true
  }
  const binding = await use(a, () => a.client.shareCooperationSphere(groupId, { id: 'algebra', name: 'Álgebra', color: '#2563eb' }))
  assert.ok(binding.id)
  assert.equal(a.downloads || 0, 0, 'publisher validates its local bytes without downloading its own files')
  assert.equal(checkedPublication, true)
  for (const actor of [b, c]) {
    await actor.fs.put('manifests/subject-catalog.json', { version: 2, subjects: { algebra: { id: 'algebra', name: 'Personal', storageKey: 'Personal' } } })
    await use(actor, () => actor.client.refreshCooperation())
    const sphere = actor.client.cooperationState().groups[0].spheres[0]
    if (actor === b) {
      actor.corruptDownload = true
      await assert.rejects(use(actor, () => actor.client.acceptCooperationSphere(sphere)), /verificación/)
      assert.equal(actor.client.cooperationState().mirrors[binding.id].downloading, true)
      assert.ok(actor.client.cooperationState().mirrors[binding.id].incoming)
      assert.equal(actor.client.cooperationState().mirrors[binding.id].metadataReady, true)
      assert.equal((await actor.fs.json('manifests/subject-catalog.json')).subjects[`coop-${binding.id}`].name, 'Álgebra')
      assert.ok(await actor.fs.json(`manifests/materials/Cooperativo-${binding.id}/week-1.json`))
      const metadataPath = `manifests/materials/Cooperativo-${binding.id}/week-1.json`
      await actor.fs.put(metadataPath, { ...await actor.fs.json(metadataPath), localNote: 'Editado durante la descarga' })
    }
    await use(actor, () => actor.client.acceptCooperationSphere(sphere))
    assert.equal(actor.client.cooperationState().mirrors[binding.id].error, undefined)
    if (actor === b) assert.equal((await actor.fs.json(`manifests/materials/Cooperativo-${binding.id}/week-1.json`)).localNote, 'Editado durante la descarga')
    assert.equal(actor.uploads || 0, 0)
    const path = `teoria/Cooperativo-${binding.id}/uno.pdf`
    assert.equal(await actor.fs.files.get(path).text(), 'test pdf')
    assert.equal(actor.fs.files.has('User.Services'), false)
    assert.equal(actor.fs.files.has('teoria/Private/secret.pdf'), false)
    assert.equal((await actor.fs.json('manifests/subject-catalog.json')).subjects.algebra.name, 'Personal')
    const board = await actor.fs.json(`progreso/pizarras/study-test-${binding.id.slice(0, 8)}.json`)
    assert.equal(board.assets['asset-a'], image)
    assert.deepEqual(board.content.shapes,[reviewMarker])
    assert.equal(Buffer.from(board.assets['audio-asset'].split(',')[1], 'base64').toString(), 'audio')
    assert.equal(board.content.media.find((item:any)=>item.id==='audio-note').mimeType,'audio/webm;codecs=opus')
    assert.equal(board.content.camera.zoom, 1)
    assert.equal(await actor.fs.files.get(`subject-voice/images/coop-${binding.id}/foto.png`).text(), 'voice image')
    assert.equal((await actor.fs.json(`manifests/subject-voice/coop-${binding.id}/workspace.json`)).notes, largeNotes)
    const synthesis = await actor.fs.json(`manifests/sintesis/coop-${binding.id}/semana-1/workspace.json`)
    assert.ok(synthesis.r2)
    assert.ok(JSON.stringify(synthesis).includes(`synthesis-local-image:synthesis-image-${binding.id.slice(0, 8)}`))
    assert.equal(await actor.fs.files.get(`sintesis/images/synthesis-image-${binding.id.slice(0, 8)}.png`).text(), 'synthesis image')
  }
  await t.test('a metadata-only receiver discovers and downloads a PDF published after acceptance', async () => {
    const mirror = b.client.cooperationState().mirrors[binding.id]
    b.fs.files.delete(`teoria/Cooperativo-${binding.id}/uno.pdf`)
    delete mirror.baseline.resources['teoria/Algebra/uno.pdf']
    mirror.baseline.seq--
    await b.fs.put(`.cooperation/${b.client.cooperationState().userId}/state.json`, b.client.cooperationState())
    await use(b, () => b.client.synchronizeCooperation())
    const recovered = b.client.cooperationState().mirrors[binding.id]
    assert.equal(recovered.error, undefined)
    assert.equal(await b.fs.files.get(`teoria/Cooperativo-${binding.id}/uno.pdf`).text(), 'test pdf')
    assert.ok(recovered.baseline.resources['teoria/Algebra/uno.pdf']?.blob)
    assert.equal(b.client.cooperationState().deletions.length, 0)
  })
  const pathA = 'manifests/materials/Algebra/week-1.json', pathB = `manifests/materials/Cooperativo-${binding.id}/week-1.json`
  const localA = await a.fs.json(pathA), localB = await b.fs.json(pathB)
  localA.materials.push({ id: 101, file_name: 'Dos.pdf' }); localB.materials.push({ id: 102, file_name: 'Tres.pdf' })
  await a.fs.put(pathA, localA); await b.fs.put(pathB, localB)
  await use(a, () => a.client.synchronizeCooperation()); await use(b, () => b.client.synchronizeCooperation()); await use(a, () => a.client.synchronizeCooperation())
  assert.equal((await a.fs.json(pathA)).materials.length, 3)
  assert.equal((await b.fs.json(pathB)).materials.length, 3)
  assert.equal(a.client.cooperationState().deletions.length, 0, 'adding PDFs does not create deletion notices')
  assert.equal(b.client.cooperationState().deletions.length, 0, 'independent additions preserve both collections')
  const stale = { id: 'stale-notice', sphereId: binding.id, key: pathA, selector: ['materials', '@100'], label: 'Elemento', decision: 'wait' }
  b.client.cooperationState().deletions.push(stale)
  await b.fs.put(`.cooperation/${b.client.cooperationState().userId}/state.json`, b.client.cooperationState())
  await use(b, () => b.client.synchronizeCooperation())
  assert.equal(b.client.cooperationState().deletions.some(row => row.id === stale.id), false, 'old notices disappear when the element still exists in cooperation')
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
  // Choosing installs preview metadata only, then selected weeks and future weeks.
  await use(d, async () => {
    await d.client.refreshCooperation()
    const sphere = d.client.cooperationState().groups[0].spheres[0]
    await d.client.acceptCooperationSphere(sphere, { choose: true })
    assert.equal([...d.fs.files.keys()].some(path => path.endsWith('.pdf')), false)
    assert.ok(await d.fs.json(`manifests/materials/Cooperativo-${binding.id}/week-2.json`))
    assert.equal(d.client.cooperationState().mirrors[binding.id].selection.choosing, true)
    await d.client.toggleCooperationWeek(binding.id, 1)
    await d.client.finishCooperationSelection(binding.id)
    await d.client.synchronizeCooperation()
    assert.equal(d.client.cooperationState().mirrors[binding.id].error, undefined)
    assert.equal(d.fs.files.has(`manifests/materials/Cooperativo-${binding.id}/week-2.json`), false)
    assert.ok(await d.fs.json(`manifests/sintesis/coop-${binding.id}/semana-1/workspace.json`))
    // Exclusions survive another normal reconciliation and cannot delete remote weeks.
    await d.client.synchronizeCooperation()
  })
  await a.fs.put('manifests/materials/Algebra/week-206.json', { weekNumber: 206, materials: [{ id: 206, file_name: 'Futuro.pdf', drive_file_id: 'workspace://teoria/Algebra/futuro.pdf' }] })
  await a.fs.put('teoria/Algebra/futuro.pdf', new Blob(['future PDF'], { type: 'application/pdf' }))
  await a.fs.put('manifests/materials/Algebra/week-2.json', { weekNumber: 2, materials: [{ id: 207, file_name: 'Excluido.pdf', drive_file_id: 'workspace://teoria/Algebra/excluido.pdf' }] })
  await a.fs.put('teoria/Algebra/excluido.pdf', new Blob(['excluded PDF'], { type: 'application/pdf' }))
  await use(a, () => a.client.synchronizeCooperation())
  await use(d, async () => {
    await d.client.synchronizeCooperation()
    assert.equal(d.client.cooperationState().mirrors[binding.id].error, undefined)
    assert.equal(await d.fs.files.get(`teoria/Cooperativo-${binding.id}/futuro.pdf`).text(), 'future PDF')
    assert.equal(d.fs.files.has(`teoria/Cooperativo-${binding.id}/excluido.pdf`), false)
    assert.equal(d.fs.files.has(`manifests/materials/Cooperativo-${binding.id}/week-2.json`), false)
  })
  await use(a, () => a.client.synchronizeCooperation())
  assert.equal((await a.fs.json('manifests/materials/Algebra/week-2.json')).materials[0].file_name, 'Excluido.pdf')

  await t.test('a change arriving during an upload is drained and an unchanged snapshot does not reload the UI', async () => {
    let queued = false
    a.beforeUpload = async () => {
      if (queued) return
      queued = true
      await a.fs.put('manifests/entries/Algebra/week-209.json', { entries: [{ id: 'during-upload', text: 'saved while uploading' }] })
      void a.client.synchronizeCooperation()
    }
    await a.fs.put('teoria/Algebra/demand.pdf', new Blob(['demand upload'], { type: 'application/pdf' }))
    await use(a, () => a.client.synchronizeCooperation())
    const snapshot = await (await backend.request(`/api/cooperation/spheres/${binding.id}/snapshot`, { cookie: a.cookie })).json()
    assert.equal(snapshot.resources['manifests/entries/Algebra/week-209.json'].value.entries[0].id, 'during-upload')
    let applied = 0
    const update = () => { applied++ }
    window.addEventListener('cursado-cooperation-applied', update)
    try { await use(a, () => a.client.synchronizeCooperation()); assert.equal(applied, 0) }
    finally { window.removeEventListener('cursado-cooperation-applied', update) }
  })

})
