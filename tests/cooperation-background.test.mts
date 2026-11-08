import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

test('file cooperation stays stopped through saves, reconnects, focus and visibility changes', async t => {
  const bundled = await build({ entryPoints: ['lib/client/cooperation.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' })
  const globals = globalThis as any
  const original = { fetch: globals.fetch, window: globals.window, localStorage: globals.localStorage, WebSocket: globals.WebSocket, BroadcastChannel: globals.BroadcastChannel, document: globals.document }
  const visibility = Object.assign(new EventTarget(), { hidden: false, visibilityState: 'visible' })
  const events = new EventTarget(), work: string[] = []
  globals.window = events
  globals.document = visibility
  globals.localStorage = { getItem: () => { work.push('storage read'); return 'previously-pending' }, setItem: () => { work.push('storage write') } }
  globals.fetch = async () => { work.push('fetch'); throw new Error('File services must remain stopped') }
  globals.WebSocket = class { constructor() { work.push('socket') } }
  globals.BroadcastChannel = class { constructor() { work.push('channel') } }
  t.after(() => { Object.assign(globals, original) })
  const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const stops = [client.startCooperationBackground(), client.startCooperationBackground()]
  for (const name of ['cursado-workspace-saved', 'online', 'focus', 'cursado-services-changed', 'cursado-cooperation-changed']) {
    events.dispatchEvent(new Event(name))
    t.mock.timers.tick(3_600_000)
    await new Promise(resolve => setImmediate(resolve))
  }
  visibility.hidden = true; visibility.visibilityState = 'hidden'
  visibility.dispatchEvent(new Event('visibilitychange'))
  visibility.hidden = false; visibility.visibilityState = 'visible'
  visibility.dispatchEvent(new Event('visibilitychange'))
  stops.forEach(stop => { stop(); stop() })
  client.startCooperationBackground()()
  t.mock.timers.tick(3_600_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(work, [], 'no scheduler, discovery, storage scan or file connection may restart')
})
