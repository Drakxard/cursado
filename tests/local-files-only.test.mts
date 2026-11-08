import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

const bundled = await build({ stdin: { resolveDir: process.cwd(), contents: `
  export { startCooperationBackground, cooperationState, restoreLocalCooperationBoards, cooperationStudyRoomId, localCooperationBoardId } from './lib/client/cooperation.ts';
  export { syncSynthesis } from './lib/client/synthesis-sync.ts';
  export { enqueueLocalWidgetCatalog, enqueueLocalNotebookWidgetTargets, processLocalDriveSyncQueue, processLocalWidgetTargetSyncQueue } from './lib/local-workspace-data.ts';
  export { setReadyWorkspaceHandle } from './lib/local-workspace-client.ts';
` }, bundle: true, write: false, platform: 'browser', format: 'esm' })
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const { startCooperationBackground, cooperationState, syncSynthesis, enqueueLocalWidgetCatalog, enqueueLocalNotebookWidgetTargets, processLocalDriveSyncQueue, processLocalWidgetTargetSyncQueue } = client

test('local saves and startup never start file transfers or require a workspace scan', async t => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { assert.fail('Local mode must not contact file services') }
  t.after(() => { globalThis.fetch = original })
  // No browser, folder or credentials: these entry points must stop before
  // opening IndexedDB, inspecting local files or setting up background work.
  const stop = startCooperationBackground()
  stop(); stop()
  await enqueueLocalWidgetCatalog([{ id: 'local', name: 'Local', color: '#ffffff' }])
  await enqueueLocalNotebookWidgetTargets(['local'])
  assert.deepEqual(await processLocalDriveSyncQueue(), { synced: 0, pending: 0, failed: 0, errors: [] })
  assert.equal((await processLocalWidgetTargetSyncQueue()).pending, 0)
  assert.equal(await syncSynthesis({ subjectId: 'local', weekNumber: 1 }), true)
  assert.equal(Object.keys(cooperationState().mirrors).length, 0)
})

test('existing cooperative board identities survive without loading transfers or modifying saved files', async t => {
  const globals = globalThis as any
  const old = { window: globals.window, localStorage: globals.localStorage, fetch: globals.fetch }
  globals.window = new EventTarget()
  globals.localStorage = { getItem: (key: string) => key === 'cursado-cooperation-user' ? 'person' : null }
  globals.fetch = async () => { assert.fail('Restoring board identities must stay local') }
  t.after(() => { Object.assign(globals, old); client.setReadyWorkspaceHandle(null) })
  const fs = memoryWorkspace(), binding = { id: 'abcdefgh123', subjectId: 'local-subject', sourceId: 'source-subject', storageKey: 'local', sourceKey: 'source', groupId: 'group', owner: false, name: 'Materia', color: '#fff' }
  const saved = { version: 1, userId: 'person', groups: [], deletions: [], mirrors: { [binding.id]: { binding, baseline: { seq: 3, conflicts: [], resources: { 'large.pdf': { key: 'large.pdf', type: 'blob', blob: { hash: 'saved', size: 99999999 } } } } } } }
  await fs.put('.cooperation/person/state.json', saved)
  client.setReadyWorkspaceHandle(fs.root)
  await client.restoreLocalCooperationBoards()
  assert.equal(client.localCooperationBoardId('local-subject', 'study-board'), 'study-board-abcdefgh')
  assert.ok(await client.cooperationStudyRoomId('local-subject', 'study-board-abcdefgh'))
  assert.deepEqual(client.cooperationState().mirrors[binding.id].baseline.resources, {})
  assert.deepEqual(await fs.json('.cooperation/person/state.json'), saved)
})
