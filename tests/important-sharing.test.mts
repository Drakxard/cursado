import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { authRuntime } from './cloudflare-runtime.mjs'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'
import { appendSharedTopics, unionSharedTopics, type SharedImportantRow } from '../lib/important-sharing.ts'
import { readImportantTasks, writeImportantTasks } from '../lib/important-tasks.ts'

test('a locally removed button stays absent; an addition from any participant is appended', () => {
  const row: SharedImportantRow = { text: 'A', startDate: '2026-01-01', dueDate: '2026-02-01', url: '', topics: [{ id: 'a', name: 'A' }], deliveries: [] }
  const task = { id: 'local', ...row, topics: ['B'], topicBoardIds: ['b'] }
  const shared = unionSharedTopics(row, [task])
  assert.deepEqual(shared.topics.map(t => t.id), ['a', 'b'])
  assert.deepEqual(appendSharedTopics({ ...task, topics: [], topicBoardIds: [] }, shared, ['a']).topicBoardIds, ['b'])
})

test('stale Important saves preserve a delivered row and still allow explicit local deletion', async () => {
  const fs = memoryWorkspace(), a = { id: 'a', text: 'A', startDate: '2026-01-01', dueDate: '2026-02-01', url: '', topics: [] }
  await writeImportantTasks(fs.root, [a])
  await writeImportantTasks(fs.root, [a, { ...a, id: 'b' }])
  await writeImportantTasks(fs.root, [{ ...a, text: 'Edited' }], [a])
  assert.deepEqual((await readImportantTasks(fs.root)).map(t => t.id), ['a', 'b'])
  await writeImportantTasks(fs.root, [], await readImportantTasks(fs.root))
  assert.deepEqual(await readImportantTasks(fs.root), [])
})

test('real cooperative rooms deliver repeated rows, accept additions from recipients and keep deletions local', async t => {
  const backend = authRuntime(); t.after(() => backend.close())
  const globals = globalThis as any, oldWindow = globals.window, oldFetch = globals.fetch, oldReader = globals.FileReader
  globals.window = new EventTarget()
  globals.FileReader = class { result = ''; onload; onerror; readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload() }).catch(error=>this.onerror(error)) } }
  t.after(() => { globals.window = oldWindow; globals.fetch = oldFetch; globals.FileReader = oldReader; delete globals.__importantContext })
  const actors = [] as any[]
  for (const name of ['ImportantA', 'ImportantB', 'ImportantStranger']) {
    const response = await backend.request('/api/auth/guest', { body: { name, password: 'testing-important' } }), user = await response.json()
    actors.push({ cookie: response.headers.get('set-cookie').split(';')[0], fs: memoryWorkspace(), state: { userId: user.id, groups: [] } })
  }
  const request = (actor, path, body?) => backend.request(`/api/cooperation/${path}`, { cookie: actor.cookie, ...(body === undefined ? {} : { body }) })
  const [a,b,stranger] = actors
  const { id: groupId } = await (await request(a, 'groups', { names: 'ImportantB' })).json()
  await request(b, `groups/${groupId}/accept`, {})
  const refresh = async actor => { const result = await (await request(actor, 'groups')).json(); actor.state.userId = result.user.id; actor.state.groups = result.groups }
  await refresh(a); await refresh(b)
  const bundled = await build({ entryPoints: ['lib/client/important-cooperation.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'context', setup(builder) {
    builder.onResolve({ filter: /\/(cooperation|cooperation-upload|local-workspace-client)(?:\.ts)?$/ }, args => ({ path: args.path.split('/').at(-1)!.replace('.ts',''), namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path==='cooperation' ? 'export const cooperationState=()=>globalThis.__importantContext.state;export const cooperationApi=(...args)=>globalThis.__importantContext.api(...args);export const refreshCooperation=()=>globalThis.__importantContext.refresh();' : path==='cooperation-upload' ? 'export const uploadCooperationFile=(...args)=>globalThis.__importantContext.upload(...args)' : 'export const getReadyWorkspaceHandle=()=>globalThis.__importantContext.fs.root;export const getReadyInscreenConfigToken=()=>"";' }))
  } }] })
  const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  const use = actor => {
    actor.api = async (path, body?) => { const response = await request(actor,path,body); const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));if(actor.dropCommit&&path.endsWith('/operations')){actor.dropCommit=false;throw new Error('Lost commit response')}return data }
    actor.refresh = () => refresh(actor)
    actor.upload = async (id,hash,blob,mime) => {
      await actor.api(`spheres/${id}/files/${hash}`, { size: blob.size,mime })
      const response=await backend.fetch(new Request(`https://backend.test/api/cooperation/spheres/${id}/files/${hash}`,{method:'PUT',headers:{Cookie:actor.cookie,Origin:backend.env.CURSADO_ORIGIN,'Content-Type':mime},body:blob}))
      assert.equal(response.status,200)
    }
    globals.__importantContext=actor
    globals.fetch = (url, options) => typeof url==='string'&&url.startsWith('/pizarra/api/') ? backend.fetch(new Request('https://backend.test'+url.slice('/pizarra'.length),{...options,headers:{Cookie:actor.cookie}})) : oldFetch(url,options)
  }
  const row = { id: 'original', text: 'Mismo nombre', startDate: '2026-01-01', dueDate: '2026-02-01', url: '', topics: ['Uno'], topicBoardIds: ['board-one'] }
  await writeImportantTasks(a.fs.root,[row])
  await a.fs.put('progreso/pizarras/board-one.json', {version:1,boardId:'board-one',name:'Uno',assets:{image:'data:image/png;base64,aW1hZ2U='},content:{strokes:[],shapes:[],texts:[{id:'t',text:'Original'}],media:[{id:'picture',assetId:'image'}],camera:{x:0,y:0,zoom:1}}})
  use(a);a.dropCommit=true
  await assert.rejects(client.shareImportantTasks(groupId,['original']),/Lost commit response/)
  await client.shareImportantTasks(groupId,['original'])
  const id=(await readImportantTasks(a.fs.root))[0].cooperation!.shareId
  assert.equal((await request(stranger,`spheres/${id}/snapshot`)).status,403)
  await refresh(b); use(b); await client.synchronizeImportantShares()
  assert.equal((await readImportantTasks(b.fs.root)).length,1)
  assert.equal((await b.fs.json('progreso/pizarras/board-one.json')).content.texts[0].text,'Original')
  assert.equal((await b.fs.json('progreso/pizarras/board-one.json')).assets.image,'data:image/png;base64,aW1hZ2U=')
  const editedBoard = await b.fs.json('progreso/pizarras/board-one.json')
  editedBoard.content.texts[0].text='Edited by recipient'
  await b.fs.put('progreso/pizarras/board-one.json',editedBoard)
  const received=(await readImportantTasks(b.fs.root))[0]
  await writeImportantTasks(b.fs.root,[{...received,topics:['Dos'],topicBoardIds:['board-two']}])
  await client.synchronizeImportantShares()
  use(a);await client.synchronizeImportantShares()
  assert.equal((await a.fs.json('progreso/pizarras/board-one.json')).content.texts[0].text,'Edited by recipient')
  assert.deepEqual((await readImportantTasks(a.fs.root))[0].topicBoardIds,['board-one','board-two'])
  use(b);await client.synchronizeImportantShares()
  assert.deepEqual((await readImportantTasks(b.fs.root))[0].topicBoardIds,['board-two'])
  await writeImportantTasks(b.fs.root,[]);await client.synchronizeImportantShares();await client.synchronizeImportantShares()
  assert.deepEqual(await readImportantTasks(b.fs.root),[])
  use(a);await client.shareImportantTasks(groupId,['original'])
  use(b);await client.synchronizeImportantShares()
  assert.equal((await readImportantTasks(b.fs.root)).length,1)
  use(a);await client.shareImportantTasks(groupId,['original'])
  use(b);await client.synchronizeImportantShares()
  assert.equal((await readImportantTasks(b.fs.root)).length,2)
  assert.equal(b.state.groups[0].spheres.length,0)
})

