import assert from 'node:assert/strict'
import test from 'node:test'
import { createUploadQueue, retryDelay } from '../pizarra-sync/packages/client-web/src/upload-queue.ts'
import { migrationErrorSummary } from '../lib/study-board-migration.ts'

test('large migrations stay below the existing upload rate without real waits', async () => {
  let clock = 0
  const requests: number[] = []
  const upload = createUploadQueue({ now: () => clock, sleep: async ms => { clock += ms }, fetch: async () => { requests.push(clock); return new Response('{}') } })
  await Promise.all(Array.from({ length: 65 }, () => upload('https://worker/upload', { method: 'POST' })))
  assert.equal(requests.length, 65)
  assert.equal(requests[24], 60000); assert.equal(requests[48], 120000)
  for (const at of requests) assert.ok(requests.filter(time => time > at - 60000 && time <= at).length <= 24)
})

test('429 honors Retry-After and transient server failures retry automatically', async () => {
  let clock = 0, calls = 0
  const pauses: number[] = []
  const upload = createUploadQueue({ now: () => clock, sleep: async ms => { clock += ms }, fetch: async () => {
    calls++
    return calls === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }) : calls === 2 ? new Response('{}', { status: 503 }) : new Response('{}')
  } })
  const response = await upload('https://worker/upload', { method: 'POST' }, ms => { if (ms) pauses.push(ms) })
  assert.equal(response.status, 200); assert.equal(calls, 3); assert.deepEqual(pauses, [2000, 2000])
})

test('invalid images do not retry, and an exhausted network failure does not block later uploads', async () => {
  let calls = 0
  const invalid = createUploadQueue({ fetch: async () => { calls++; return new Response('{}', { status: 415 }) } })
  assert.equal((await invalid('https://worker/upload', {})).status, 415); assert.equal(calls, 1)
  calls = 0
  const upload = createUploadQueue({ attempts: 2, sleep: async () => {}, fetch: async () => { if (++calls <= 2) throw new Error('offline'); return new Response('{}') } })
  await assert.rejects(upload('https://worker/upload', {}), /offline/)
  assert.equal((await upload('https://worker/upload', {})).status, 200)
})

test('Retry-After accepts HTTP dates, and repeated errors have a bounded summary', () => {
  const now = Date.UTC(2026, 9, 29)
  assert.equal(retryDelay(new Date(now + 11000).toUTCString(), now, 60000), 11000)
  assert.equal(retryDelay('0', now, 60000), 250)
  assert.equal(retryDelay('invalid', now, 60000), 60000)
  const summary = migrationErrorSummary(Array(100).fill('Imágenes: No se pudo subir (HTTP 429)'))
  assert.equal(summary, 'Imágenes: No se pudo subir (HTTP 429) (100 elementos)')
  assert.ok(summary.length < 100)
})
