import assert from 'node:assert/strict'
import test from 'node:test'
import { startVisibleTask } from '../lib/client/visible-task.ts'
import { createIdleSync, SOLO_SYNC_INTERVAL_MS } from '../lib/client/idle-sync.ts'

class Visibility extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
  set(hidden: boolean) { this.visibilityState = hidden ? 'hidden' : 'visible'; this.dispatchEvent(new Event('visibilitychange')) }
}
const settle = async () => { for (let index = 0; index < 10; index++) await Promise.resolve() }

test('periodic UI work has no hidden wakeups and refreshes once on return', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const visibility = new Visibility()
  let runs = 0
  const stop = startVisibleTask(() => { runs++ }, 5000, visibility as Document)
  t.mock.timers.tick(5000); await settle(); assert.equal(runs, 1)
  visibility.set(true)
  t.mock.timers.tick(600_000); await settle(); assert.equal(runs, 1)
  visibility.set(false); await settle(); assert.equal(runs, 2)
  t.mock.timers.tick(5000); await settle(); assert.equal(runs, 3)
  stop(); visibility.set(true); visibility.set(false)
  t.mock.timers.tick(60_000); await settle(); assert.equal(runs, 3)
})

test('slow periodic work never overlaps and stopping does not leave a timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const visibility = new Visibility()
  let release!: () => void, runs = 0
  const stop = startVisibleTask(() => { runs++; return new Promise<void>(resolve => { release = resolve }) }, 1000, visibility as Document)
  t.mock.timers.tick(1000); await settle()
  visibility.set(true); visibility.set(false)
  t.mock.timers.tick(60_000); await settle(); assert.equal(runs, 1)
  stop(); release(); await settle()
  t.mock.timers.tick(60_000); await settle(); assert.equal(runs, 1)
})

test('hidden deferred sync preserves pending saves and runs when visible again', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const visibility = new Visibility(), values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) || '', setItem: (key: string, value: string) => { values.set(key, value) } }
  let runs = 0
  const scheduler = createIdleSync({ run: async () => { runs++ }, target: new EventTarget(), visibility, storage, storageKey: 'pending' })
  t.after(() => scheduler.stop())
  scheduler.request(); visibility.set(true)
  t.mock.timers.tick(2 * SOLO_SYNC_INTERVAL_MS); await settle()
  assert.equal(runs, 0); assert.ok(storage.getItem('pending'))
  visibility.set(false); t.mock.timers.tick(0); await settle()
  assert.equal(runs, 1); assert.equal(storage.getItem('pending'), '')
})
