import test from 'node:test'
import assert from 'node:assert/strict'
import { pruneDeployments, projectId, teamId, vercelRequest } from '../scripts/prune-vercel-deployments.mjs'

function fixture() {
  const deleted: string[] = []
  let active = 'dpl_current'
  const request = async (path: string, method = 'GET'): Promise<any> => {
    if (method === 'DELETE') { deleted.push(path.split('/').at(-1)!); return {} }
    if (path.startsWith('/v9/')) return { id: projectId, accountId: teamId, targets: { production: { id: active, createdAt: 100, readyState: 'READY' } } }
    if (path.startsWith('/v4/')) return { projectId, deploymentId: active }
    if (path.startsWith('/v7/')) {
      const second = new URL(path, 'https://test').searchParams.has('until')
      return { deployments: (second ? [{ uid: 'dpl_old2', created: 10, state: 'ERROR' }] : [
        { uid: 'dpl_current', created: 100, state: 'READY' },
        { uid: 'dpl_old', created: 50, state: 'READY' },
        { uid: 'dpl_building', created: 110, state: 'BUILDING' },
        { uid: 'dpl_staged', created: 120, state: 'READY', target: 'production' },
        { uid: 'dpl_preview', created: 130, state: 'READY', target: null },
      ]).map(d => ({ ...d, projectId })), pagination: { next: second ? null : 10 } }
    }
    return { projectId, id: path.split('/').at(-1), readyState: 'READY', createdAt: 100 }
  }
  return { request, deleted, promote: () => { active = 'dpl_promoted' } }
}

test('cleanup dry-run traverses pages, preserves active/building/staged production and performs no deletion', async () => {
  const f = fixture()
  const result = await pruneDeployments({ request: f.request, log: () => {} })
  assert.equal(result.candidates, 3); assert.equal(result.total, 6)
  assert.deepEqual(f.deleted, [])
})
test('cleanup deletes only obsolete deployments in the specified project', async () => {
  const f = fixture()
  const result = await pruneDeployments({ request: f.request, apply: true, log: () => {} })
  assert.equal(result.removed, 3)
  assert.deepEqual(f.deleted, ['dpl_old', 'dpl_preview', 'dpl_old2'])
})
test('a production promotion during cleanup stops before deleting the next candidate', async () => {
  const f = fixture()
  await assert.rejects(pruneDeployments({ apply: true, log: () => {}, request: async (path: string, method?: string) => {
    const result = await f.request(path, method)
    if (path === '/v13/deployments/dpl_old') f.promote()
    return result
  } }), /Cambió la producción/)
  assert.deepEqual(f.deleted, [])
})
test('an alias mismatch or a foreign project prevents deletion', async () => {
  for (const mismatch of ['alias', 'list', 'detail']) {
    const f = fixture()
    await assert.rejects(pruneDeployments({ apply: true, log: () => {}, request: async (path: string, method?: string) => {
      const result = await f.request(path, method)
      if (mismatch === 'alias' && path.startsWith('/v4/')) result.deploymentId = 'dpl_other'
      if (mismatch === 'list' && path.startsWith('/v7/')) result.deployments[0].projectId = 'foreign'
      if (mismatch === 'detail' && path.startsWith('/v13/')) result.projectId = 'foreign'
      return result
    } }))
    assert.deepEqual(f.deleted, [])
  }
})
test('missing credentials fail before any request', () => {
  assert.throws(() => vercelRequest(undefined), /Falta VERCEL_TOKEN/)
})

test('the domain remains protected when the production target points to a newer build', async () => {
  const f = fixture()
  const result = await pruneDeployments({ apply: true, log: () => {}, request: async (path: string, method?: string) => {
    const result = await f.request(path, method)
    if (path.startsWith('/v9/')) result.targets.production = { id: 'dpl_building', readyState: 'BUILDING' }
    return result
  } })
  assert.equal(result.active, 'dpl_current')
  assert.deepEqual(f.deleted, ['dpl_old', 'dpl_preview', 'dpl_old2'])
})
