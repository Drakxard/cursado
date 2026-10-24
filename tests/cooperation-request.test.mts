import assert from 'node:assert/strict'
import test from 'node:test'
import { cooperationRequest } from '../lib/client/cooperation-request.ts'

test('temporary failures retry reads and deduplicated commits with identical payloads', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const [path, body] of [['groups', undefined], ['spheres/shared/operations', { id: 'same-operation', changes: [] }]] as const) {
    const payloads: unknown[] = []
    globalThis.fetch = (async (_url, options) => {
      payloads.push(options?.body)
      if (payloads.length === 1) return Response.json({ detail: 'Temporary' }, { status: 503 })
      if (payloads.length === 2) throw new TypeError('Failed to fetch')
      return Response.json({ ok: true })
    }) as typeof fetch
    assert.deepEqual(await cooperationRequest(path, body), { ok: true })
    assert.equal(payloads.length, 3)
    assert.ok(payloads.every(value => value === payloads[0]))
  }
})

test('persistent failures remain visible and unsafe writes and authentication errors are not replayed', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const scenario of [
    { path: 'groups', body: undefined, status: 503, count: 3 },
    { path: 'groups', body: { names: 'Someone' }, status: 503, count: 1 },
    { path: 'spheres/shared/operations', body: { changes: [] }, status: 503, count: 1 },
    { path: 'groups', body: undefined, status: 401, count: 1 },
  ]) {
    let calls = 0
    globalThis.fetch = (async () => { calls++; return Response.json({ detail: 'Still failing' }, { status: scenario.status }) }) as typeof fetch
    await assert.rejects(cooperationRequest(scenario.path, scenario.body), /Still failing/)
    assert.equal(calls, scenario.count)
  }
})
