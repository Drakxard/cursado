import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('saved additions stay deleted on refresh and discarded reads do not advance the merge baseline', async t => {
  const fs = memoryWorkspace()
  const fixture = { board: null as any }
  ;(globalThis as any).__topicSyncFixture = fixture
  const previousParent = globalThis.parent, previousLocation = globalThis.location
  globalThis.parent = { postMessage() {} } as any
  globalThis.location = { origin: 'https://test.local' } as any
  t.after(() => {
    globalThis.parent = previousParent; globalThis.location = previousLocation
    delete (globalThis as any).__topicSyncFixture
  })
  const bundle = await build({ entryPoints: ['pizarraproyecto-main/src/topicWorkspace.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'storage', setup(builder) {
    builder.onResolve({ filter: /^\.\/(biblioteca|storage\/device|nativeWorkspace)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      const fixture=globalThis.__topicSyncFixture;
      export const getActiveBoardId=()=> 'local:important-board';
      export const selectBoard=()=>{}; export const setStorageSession=()=>{};
      export const nativeBoardMode=()=>false;
      export const emptyContent=()=>({strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}});
      export const readDeviceBoard=async()=>fixture.board;
      export const writeDeviceBoard=async board=>{fixture.board=board};
      export const deviceDB=Promise.resolve({put:async()=>{}});
    ` }))
  } }] })
  const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
  await client.initializeTopicWorkspace({ boardId: 'board', name: 'Board', rootHandle: fs.root })
  const shape = { id: 'added', x: 10, y: 20, width: 30 }
  fixture.board.content.shapes = [shape]
  await client.saveTopicWorkspace()
  fixture.board.content.shapes = []
  await client.saveTopicWorkspace()
  const received = await client.receiveTopicWorkspace(structuredClone(fixture.board.content))
  assert.deepEqual(received.shapes, [], 'an acknowledged local deletion must not reappear')

  const path = 'progreso/pizarras/board.json'
  const remote = await fs.json(path)
  remote.content.shapes = [shape]
  await fs.put(path, remote)
  assert.equal(await client.receiveTopicWorkspace(received, () => false), null)
  const current = await client.receiveTopicWorkspace(received)
  assert.deepEqual(current.shapes, [shape], 'a discarded read must not consume incoming changes')
})
