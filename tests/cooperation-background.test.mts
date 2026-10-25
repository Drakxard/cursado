import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { authRuntime } from './cloudflare-runtime.mjs'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('background sync is idle without events, batches saves, discovers invitations on push and reconnects on demand', async t => {
  const bundled = await build({ entryPoints: ['lib/client/cooperation.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'workspace', setup(builder) {
    builder.onResolve({ filter: /local-workspace-client\.ts$/ }, () => ({ path: 'root', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const getReadyWorkspaceHandle=()=>globalThis.__backgroundRoot;export const loadWorkspaceHandle=async()=>globalThis.__backgroundRoot;export const queryWorkspacePermission=async()=>"granted";export const getReadyInscreenConfigToken=()=>"";export const loadServicesFile=async()=>null' }))
  } }] })
  const backend = authRuntime(), fs = memoryWorkspace()
  const original = { fetch: globalThis.fetch, window: globalThis.window, storage: globalThis.localStorage, socket: globalThis.WebSocket, channel: globalThis.BroadcastChannel }
  globalThis.window = new EventTarget() as any
  globalThis.localStorage = { getItem: () => null, setItem: () => {} } as any
  ;(globalThis as any).__backgroundRoot = fs.root
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  const sockets: any[] = [], requests: string[] = []
  globalThis.WebSocket = class { onmessage; onclose; onopen; onerror; url: string; constructor(url: string) { this.url = url; sockets.push(this) } close() { this.onclose?.() } } as any
  globalThis.BroadcastChannel = class { onmessage; close() {} } as any
  t.after(() => { backend.close(); globalThis.fetch = original.fetch; globalThis.window = original.window; globalThis.localStorage = original.storage; globalThis.WebSocket = original.socket; globalThis.BroadcastChannel = original.channel; delete (globalThis as any).__backgroundRoot })
  const response = await backend.request('/api/auth/guest', { body: { name: 'Demand', password: 'test-only' } })
  const cookie = response.headers.get('set-cookie')!.split(';')[0]
  globalThis.fetch = (async (url, options = {}) => {
    requests.push(String(url))
    return backend.fetch(new Request(`https://backend.test${String(url).replace(/^\/pizarra/, '')}`, { ...options, headers: { ...options.headers as any, Cookie: cookie, Origin: backend.env.CURSADO_ORIGIN } }))
  }) as typeof fetch
  const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)) }
  const waitFor = async (predicate: () => boolean) => { for (let i = 0; i < 500 && !predicate(); i++) await settle(); assert.ok(predicate()) }
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const stop = client.startCooperationBackground(), stopSecond = client.startCooperationBackground()
  t.after(stop); t.after(stopSecond)
  await waitFor(() => sockets.length === 1)
  await client.synchronizeCooperation(); await settle()
  const idle = requests.length
  t.mock.timers.tick(60_000); await settle()
  assert.equal(requests.length, idle)
  sockets[0].onmessage({ data: JSON.stringify({ type: 'directory_changed', seq: 1 }) })
  await waitFor(() => requests.length > idle)
  await client.synchronizeCooperation(); await settle()
  const afterPush = requests.length
  window.dispatchEvent(new Event('cursado-workspace-saved'))
  window.dispatchEvent(new Event('cursado-workspace-saved'))
  t.mock.timers.tick(250); await settle()
  assert.equal(requests.length, afterPush) // No sphere needs syncing; saves do not poll the directory.
  stop()
  sockets[0].onclose()
  t.mock.timers.tick(1000)
  await waitFor(() => sockets.length === 2)
  await client.synchronizeCooperation(); await settle()
  stopSecond()
  const stopped = requests.length
  t.mock.timers.tick(60_000); window.dispatchEvent(new Event('focus')); await settle()
  assert.equal(requests.length, stopped)

  // Exercise the real mirror wiring: a connection greeting must not bypass
  // idle scheduling, whereas a collaborator joining must flush pending saves.
  await backend.request('/api/auth/guest', { body: { name: 'IdlePeer', password: 'test-only' } })
  await fs.put('manifests/subject-catalog.json', { version: 2, subjects: { math: { id: 'math', name: 'Math', storageKey: 'Math' } } })
  const group = await client.createCooperationGroup('IdlePeer')
  const binding = await client.shareCooperationSphere(group, { id: 'math', name: 'Math', color: '#123456' })
  await waitFor(() => sockets.some(socket => socket.url.includes(`/socket/${binding.id}`)))
  t.mock.timers.reset()
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.now() })
  const stopThird = client.startCooperationBackground()
  t.after(stopThird)
  await waitFor(() => sockets.length === 4)
  await settle()
  const sphereSocket = sockets.find(socket => socket.url.includes(`/socket/${binding.id}`))
  assert.ok(sphereSocket)
  const snapshotCount = () => requests.filter(url => url.includes('/snapshot')).length
  const initialSnapshots = snapshotCount()
  sphereSocket.onmessage({ data: JSON.stringify({ type: 'changed', seq: client.cooperationState().mirrors[binding.id].baseline.seq }) })
  window.dispatchEvent(new Event('cursado-workspace-saved'))
  t.mock.timers.tick(3_599_999); await settle()
  assert.equal(snapshotCount(), initialSnapshots)
  t.mock.timers.tick(1)
  await waitFor(() => snapshotCount() > initialSnapshots)
  await client.synchronizeCooperation(); await settle()
  const soloSnapshots = snapshotCount()
  window.dispatchEvent(new Event('cursado-workspace-saved'))
  sphereSocket.onmessage({ data: JSON.stringify({ type: 'presence', users: [{ id: client.cooperationState().userId }, { id: 'peer' }], you: client.cooperationState().userId }) })
  t.mock.timers.tick(250)
  await waitFor(() => snapshotCount() > soloSnapshots)
  await client.synchronizeCooperation()
  stopThird()
})
