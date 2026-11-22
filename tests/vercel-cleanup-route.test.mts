import test from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../app/api/internal/vercel-cleanup/route.ts'
import { projectId, teamId } from '../scripts/prune-vercel-deployments.mjs'

function credentials(t: any) {
  const previous = { trigger: process.env.VERCEL_CLEANUP_TRIGGER_SECRET, token: process.env.VERCEL_CLEANUP_TOKEN }
  process.env.VERCEL_CLEANUP_TRIGGER_SECRET = 'private-trigger'
  process.env.VERCEL_CLEANUP_TOKEN = 'private-vercel-token'
  t.after(() => {
    for (const [key, value] of Object.entries({ VERCEL_CLEANUP_TRIGGER_SECRET: previous.trigger, VERCEL_CLEANUP_TOKEN: previous.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })
}

test('the cleanup route rejects missing or incorrect authorization without contacting Vercel', async t => {
  credentials(t)
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unauthorized requests must not reach Vercel'))
  for (const authorization of ['', 'Bearer wrong', 'Bearer private-trigges']) {
    const response = await POST(new Request('https://site/api/internal/vercel-cleanup', { method: 'POST', headers: { authorization }, body: '{}' }))
    assert.equal(response.status, 401)
  }
})

test('an authorized trigger returns only a cleanup summary, never the API credential', async t => {
  credentials(t)
  t.mock.method(globalThis, 'fetch', async (url: URL | RequestInfo, options?: RequestInit) => {
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer private-vercel-token')
    assert.equal(options?.method, 'GET')
    const path = new URL(String(url)).pathname
    let data
    if (path.startsWith('/v10/')) data = { projects: [{ id: projectId, name: 'cursado', accountId: teamId, targets: { production: { alias: ['cursado.vercel.app'] } } }], pagination: { next: null } }
    else if (path.includes('/domains')) data = { domains: [], pagination: { next: null } }
    else if (path.startsWith('/v9/')) data = { id: projectId, accountId: teamId, targets: { production: { id: 'dpl_live', readyState: 'READY' } } }
    else if (path.startsWith('/v4/')) data = { projectId, deploymentId: 'dpl_live' }
    else if (path.startsWith('/v13/')) data = { id: 'dpl_live', projectId, readyState: 'READY', createdAt: 100 }
    else data = { deployments: [{ uid: 'dpl_live', projectId, state: 'READY', created: 100 }], pagination: { next: null } }
    return Response.json(data)
  })
  const response = await POST(new Request('https://site/api/internal/vercel-cleanup', {
    method: 'POST', headers: { authorization: 'Bearer private-trigger' }, body: '{"dryRun":true}',
  }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), {
    teamId, projects: [{ projectId, name: 'cursado', active: 'dpl_live', total: 1, candidates: 0, removed: 0, dryRun: true }],
    errors: [], removed: 0, dryRun: true,
  })
})

test('a missing Vercel credential stops an authorized cleanup without exposing environment data', async t => {
  credentials(t)
  delete process.env.VERCEL_CLEANUP_TOKEN
  t.mock.method(globalThis, 'fetch', () => assert.fail('Missing credentials must not make API requests'))
  const response = await POST(new Request('https://site/api/internal/vercel-cleanup', {
    method: 'POST', headers: { authorization: 'Bearer private-trigger' }, body: '{}',
  }))
  assert.equal(response.status, 503)
  assert.doesNotMatch(await response.text(), /private-trigger|private-vercel-token/)
})
