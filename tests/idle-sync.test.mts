import assert from 'node:assert/strict'
import test from 'node:test'
import { createIdleSync, SOLO_SYNC_IDLE_MS, SOLO_SYNC_INTERVAL_MS } from '../lib/client/idle-sync.ts'

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

test('solo sync uses a fixed hourly deadline despite activity and repeated saves', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const target = new EventTarget()
  let runs = 0
  const sync = createIdleSync({ target, run: async () => { runs++ } })
  t.after(() => sync.stop())
  sync.request()
  t.mock.timers.tick(120_000)
  target.dispatchEvent(new Event('pointermove'))
  sync.request()
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS - 120_000 - 1); await settle()
  assert.equal(runs, 0)
  target.dispatchEvent(new Event('keydown'))
  sync.request()
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 1)
  t.mock.timers.tick(120_000)
  sync.request()
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS - 120_000 - 1); await settle()
  assert.equal(runs, 1)
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 2)
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS * 5); await settle()
  assert.equal(runs, 2)
})

test('joining peers flush pending work live and leaving restores the hourly deadline', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  let live = false, runs = 0
  const sync = createIdleSync({ target: new EventTarget(), isLive: () => live, run: async () => { runs++ } })
  t.after(() => sync.stop())
  sync.request()
  t.mock.timers.tick(1000)
  live = true; sync.refresh()
  t.mock.timers.tick(0); await settle()
  assert.equal(runs, 1)
  sync.request()
  t.mock.timers.tick(249); await settle()
  assert.equal(runs, 1)
  live = false; sync.refresh()
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 1)
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS - 1250); await settle()
  assert.equal(runs, 2)
})

function pendingStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('reopening with pending changes waits ten idle minutes, then resumes fixed hourly sends', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const storage = pendingStorage(), target = new EventTarget()
  let runs = 0
  const options = { storage, storageKey: 'backup', target, run: async () => { runs++ } }
  const first = createIdleSync(options)
  first.request()
  t.mock.timers.tick(20 * 60_000)
  first.stop()
  assert.ok(storage.getItem('backup'))
  const reopened = createIdleSync(options)
  t.after(() => reopened.stop())
  t.mock.timers.tick(5 * 60_000)
  target.dispatchEvent(new Event('pointermove'))
  t.mock.timers.tick(SOLO_SYNC_IDLE_MS - 1); await settle()
  assert.equal(runs, 0)
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 1)
  assert.equal(storage.getItem('backup'), null)
  reopened.request()
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS - 1); await settle()
  assert.equal(runs, 1)
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 2)
})

test('offline or failed sends retain pending changes across reopening and retry on the next hour', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const storage = pendingStorage()
  let runs = 0, offline = true
  const options = { storage, storageKey: 'backup', target: new EventTarget(), run: async () => {
    runs++
    if (offline) return false
    if (runs === 2) throw new Error('upload failed')
  } }
  const first = createIdleSync(options)
  first.request()
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS); await settle()
  assert.equal(runs, 1)
  assert.ok(storage.getItem('backup'))
  first.stop()
  offline = false
  const reopened = createIdleSync(options)
  t.after(() => reopened.stop())
  t.mock.timers.tick(SOLO_SYNC_IDLE_MS); await settle()
  assert.equal(runs, 2)
  assert.ok(storage.getItem('backup'))
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS - 1); await settle()
  assert.equal(runs, 2)
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 3)
  assert.equal(storage.getItem('backup'), null)
})

test('a successful older transfer cannot clear a newer pending marker from another tab', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const storage = pendingStorage()
  let finish: () => void = () => {}
  const first = createIdleSync({ storage, storageKey: 'backup', target: new EventTarget(), run: () => new Promise<void>(resolve => { finish = resolve }) })
  first.request()
  t.mock.timers.tick(SOLO_SYNC_INTERVAL_MS)
  const second = createIdleSync({ storage, storageKey: 'backup', target: new EventTarget(), run: async () => {} })
  second.request()
  finish(); await settle()
  assert.ok(storage.getItem('backup'))
  first.stop(); second.stop()
})

test('saves during a transfer are preserved without overlapping transfers; stop cancels pending work', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  let runs = 0, finish: () => void = () => {}
  const sync = createIdleSync({ target: new EventTarget(), isLive: () => true, run: () => {
    runs++
    return new Promise<void>(resolve => { finish = resolve })
  } })
  t.after(() => sync.stop())
  sync.request(); t.mock.timers.tick(250)
  assert.equal(runs, 1)
  sync.request(); sync.request(); t.mock.timers.tick(1000)
  assert.equal(runs, 1)
  finish(); await settle(); t.mock.timers.tick(0)
  assert.equal(runs, 2)
  sync.request(); sync.stop(); finish(); await settle()
  t.mock.timers.tick(SOLO_SYNC_IDLE_MS)
  assert.equal(runs, 2)
})

test('failed live transfers retry with a bounded delay', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  let runs = 0
  const sync = createIdleSync({ target: new EventTarget(), isLive: () => true, run: async () => {
    if (++runs === 1) throw new Error('offline')
  } })
  t.after(() => sync.stop())
  sync.request(); t.mock.timers.tick(250); await settle()
  t.mock.timers.tick(SOLO_SYNC_IDLE_MS - 1); await settle()
  assert.equal(runs, 1)
  t.mock.timers.tick(1); await settle()
  assert.equal(runs, 2)
})
