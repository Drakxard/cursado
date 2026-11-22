import test from 'node:test'
import assert from 'node:assert/strict'
import { pruneTeamDeployments } from '../scripts/prune-vercel-team.mjs'
import { teamId } from '../scripts/prune-vercel-deployments.mjs'

function fixture() {
  const deleted: string[] = []
  const projects = ['a', 'b'].map(letter => ({
    id: `prj_${letter}`, name: letter, accountId: teamId,
    targets: { production: { id: `dpl_${letter}live`, readyState: 'READY', alias: [`${letter}.vercel.app`] } },
  }))
  const deployments = new Map(projects.flatMap((project, index) => {
    const letter = index ? 'b' : 'a'
    return [
      { id: `dpl_${letter}live`, projectId: project.id, readyState: 'READY', createdAt: 100, target: 'production' },
      { id: `dpl_${letter}old`, projectId: project.id, readyState: 'READY', createdAt: 50, target: 'production' },
      { id: `dpl_${letter}error`, projectId: project.id, readyState: 'ERROR', createdAt: 120, target: 'production' },
    ].map(d => [d.id, d] as const)
  }))
  const request = async (path: string, method = 'GET'): Promise<any> => {
    const url = new URL(path, 'https://test'), id = url.pathname.split('/').at(-1)!
    if (method === 'DELETE') { deleted.push(id); deployments.delete(id); return {} }
    if (url.pathname === '/v10/projects') return { projects: [projects[url.searchParams.has('from') ? 1 : 0]], pagination: { next: url.searchParams.has('from') ? null : 1 } }
    if (url.pathname === '/v7/deployments') return { deployments: [...deployments.values()].filter(d => d.projectId === url.searchParams.get('projectId')).map(d => ({ ...d, uid: d.id, state: d.readyState })), pagination: { next: null } }
    if (url.pathname.includes('/domains')) return { domains: [], pagination: { next: null } }
    if (url.pathname.startsWith('/v9/')) return projects.find(p => p.id === id)
    if (url.pathname.startsWith('/v4/')) return { projectId: `prj_${id[0]}`, deploymentId: `dpl_${id[0]}live` }
    return deployments.get(id)
  }
  return { request, deleted, projects, deployments }
}

test('one team sweep paginates projects and preserves each live version, including after failed releases', async () => {
  const f = fixture()
  const result = await pruneTeamDeployments({ request: f.request, apply: true, log: () => {} })
  assert.equal(result.errors.length, 0); assert.equal(result.removed, 4)
  assert.deepEqual(f.deleted, ['dpl_aold', 'dpl_aerror', 'dpl_bold', 'dpl_berror'])
  assert.deepEqual(result.projects.map(p => p.active), ['dpl_alive', 'dpl_blive'])
})
test('a foreign team project stops discovery before any deletion', async () => {
  const f = fixture(); f.projects[1].accountId = 'foreign'
  await assert.rejects(pruneTeamDeployments({ request: f.request, apply: true, log: () => {} }), /equipo autorizado/)
  assert.deepEqual(f.deleted, [])
})
test('different live domains protect all releases of that project while other projects can be cleaned', async () => {
  const f = fixture()
  const result = await pruneTeamDeployments({ apply: true, log: () => {}, request: async (path: string, method?: string) => {
    if (path.includes('/prj_a/domains')) return { domains: [{ name: 'other.example.com' }], pagination: { next: null } }
    if (path.endsWith('/other.example.com')) return { projectId: 'prj_a', deploymentId: 'dpl_aold' }
    return f.request(path, method)
  } })
  assert.equal(result.errors.length, 1)
  assert.deepEqual(f.deleted, ['dpl_bold', 'dpl_berror'])
})
test('an API permission failure cannot be mistaken for an absent domain', async () => {
  const f = fixture()
  const result = await pruneTeamDeployments({ apply: true, log: () => {}, request: async (path: string, method?: string) => {
    if (path.endsWith('/a.vercel.app')) throw Object.assign(new Error('forbidden'), { status: 403 })
    return f.request(path, method)
  } })
  assert.equal(result.errors.length, 1)
  assert.deepEqual(f.deleted, ['dpl_bold', 'dpl_berror'])
})
test('a never-successful project retains its latest failed attempt and deletes only older failures', async () => {
  const f = fixture()
  f.deployments.delete('dpl_alive'); f.deployments.delete('dpl_aold')
  f.deployments.set('dpl_aolderror', { id: 'dpl_aolderror', projectId: 'prj_a', readyState: 'ERROR', createdAt: 50, target: 'production' })
  const result = await pruneTeamDeployments({ apply: true, log: () => {}, request: async (path: string, method?: string) => {
    if (path.endsWith('/a.vercel.app')) throw Object.assign(new Error('not found'), { status: 404 })
    return f.request(path, method)
  } })
  assert.equal(result.errors.length, 0)
  assert.equal(result.projects[0].active, 'dpl_aerror')
  assert.deepEqual(f.deleted, ['dpl_aolderror', 'dpl_bold', 'dpl_berror'])
})
test('team dry-run reports changes without deleting anything', async () => {
  const f = fixture()
  const result = await pruneTeamDeployments({ request: f.request, log: () => {} })
  assert.equal(result.projects.reduce((n, p) => n + p.candidates, 0), 4)
  assert.equal(result.removed, 0); assert.deepEqual(f.deleted, [])
})
