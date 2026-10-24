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
      if (payloads.length === 3) return Response.json({ detail: 'Temporary' }, { status: 504 })
      return Response.json({ ok: true })
    }) as typeof fetch
    assert.deepEqual(await cooperationRequest(path, body), { ok: true })
    assert.equal(payloads.length, 4)
    assert.ok(payloads.every(value => value === payloads[0]))
  }
})

test('persistent failures remain visible and unsafe writes and authentication errors are not replayed', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const scenario of [
    { path: 'groups', body: undefined, status: 503, count: 4 },
    { path: 'groups', body: { names: 'Someone' }, status: 503, count: 1 },
    { path: 'spheres/shared/operations', body: { changes: [] }, status: 503, count: 1 },
    { path: 'groups', body: undefined, status: 401, count: 1 },
  ]) {
    let calls = 0
    globalThis.fetch = (async () => { calls++; return Response.json({ detail: 'Still failing' }, { status: scenario.status }) }) as typeof fetch
    await assert.rejects(cooperationRequest(scenario.path, scenario.body), error => {
      assert.match((error as Error).message, /Still failing/)
      assert.ok((error as Error).message.includes(`${scenario.body ? 'POST' : 'GET'} ${scenario.path}`))
      assert.ok((error as Error).message.includes(`HTTP ${scenario.status}`))
      assert.ok((error as Error).message.includes(`${scenario.count - 1} reintentos`))
      return true
    })
    assert.equal(calls, scenario.count)
  }
})

test('connection failures and non-JSON server errors include diagnostic details after three retries', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const network of [true, false]) {
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      if (network) throw new TypeError('Failed to fetch')
      return new Response('<html>Unavailable</html>', { status: 502 })
    }) as typeof fetch
    await assert.rejects(cooperationRequest('spheres/shared/snapshot'), error => {
      const message = (error as Error).message
      assert.match(message, /GET spheres\/shared\/snapshot/)
      assert.match(message, /4 intentos; 3 reintentos/)
      assert.match(message, network ? /Error de conexión: Failed to fetch/ : /HTTP 502/)
      assert.ok(!message.includes('<html>'))
      return true
    })
    assert.equal(calls, 4)
  }
})
