import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectId = 'prj_1ja4r2t6LVAPtQZuDXCDhuc05t8W'
export const teamId = 'team_Ns6JA351zpNFyu888IFzIkgy'
const domain = 'cursado.vercel.app'
const terminal = new Set(['READY', 'ERROR', 'CANCELED', 'BLOCKED'])

export function vercelRequest(token, fetcher = fetch) {
  if (!token) throw new Error('Falta VERCEL_TOKEN: no se ejecutó ninguna limpieza.')
  return async (path, method = 'GET') => {
    const url = new URL(path, 'https://api.vercel.com')
    if (url.origin !== 'https://api.vercel.com') throw new Error('Origen de API inválido')
    url.searchParams.set('teamId', teamId)
    const response = await fetcher(url, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    if (method === 'DELETE' && response.status === 404) return null
    if (!response.ok) throw new Error(`Vercel HTTP ${response.status} (${method} ${url.pathname})`)
    return response.status === 204 ? null : response.json()
  }
}

export async function pruneDeployments({ request, apply = false, log = console.log }) {
  async function active() {
    const project = await request(`/v9/projects/${projectId}`)
    const alias = await request(`/v4/aliases/${domain}`)
    const activeId = alias.deploymentId || alias.deployment?.id
    if (!/^dpl_[a-zA-Z0-9]+$/.test(activeId || '')) throw new Error('Alias de producción inválido')
    // targets.production may already point to a BUILDING deployment. The live
    // domain remains on the previous READY release until promotion completes.
    const production = await request(`/v13/deployments/${activeId}`)
    if (project.id !== projectId || project.accountId !== teamId || alias.projectId !== projectId ||
        production?.id !== activeId || production.projectId !== projectId || production?.readyState !== 'READY' ||
        (project.targets?.production?.readyState === 'READY' && project.targets.production.id !== activeId) ||
        !Number.isFinite(production.createdAt)) throw new Error('No se pudo confirmar el despliegue activo. No se borrará nada.')
    return production
  }
  const production = await active()
  log(`Conservar ${production.id}: https://${domain}`)
  const deployments = new Map(), cursors = new Set()
  let cursor
  do {
    const query = new URLSearchParams({ projectId, limit: '100' })
    if (cursor) query.set('until', String(cursor))
    const page = await request(`/v7/deployments?${query}`)
    if (!Array.isArray(page.deployments)) throw new Error('Lista de despliegues inválida')
    for (const deployment of page.deployments) {
      if (deployment.projectId !== projectId || !/^dpl_[a-zA-Z0-9]+$/.test(deployment.uid)) throw new Error('Despliegue fuera del proyecto autorizado')
      deployments.set(deployment.uid, deployment)
    }
    cursor = page.pagination?.next
    if (cursor && cursors.has(cursor)) throw new Error('La paginación no avanzó')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  const removed = [], candidates = []
  for (const deployment of deployments.values()) {
    const created = deployment.createdAt ?? deployment.created
    if (deployment.uid === production.id || !terminal.has(deployment.readyState || deployment.state) ||
        !Number.isFinite(created) || (created > production.createdAt && deployment.target === 'production')) continue
    candidates.push(deployment.uid)
    if (!apply) { log(`Eliminaría ${deployment.uid}`); continue }
    // Confirm scope and production again before EACH deletion. A concurrent
    // promotion/rollback stops this run instead of deleting a newly active release.
    const detail = await request(`/v13/deployments/${deployment.uid}`)
    if (detail.projectId !== projectId || detail.id !== deployment.uid || !terminal.has(detail.readyState)) throw new Error('El despliegue cambió; limpieza detenida')
    if ((await active()).id !== production.id) throw new Error('Cambió la producción; repetir la limpieza con el nuevo despliegue activo')
    await request(`/v13/deployments/${deployment.uid}`, 'DELETE')
    removed.push(deployment.uid)
    log(`Eliminado ${deployment.uid}`)
  }
  const summary = { active: production.id, total: deployments.size, candidates: candidates.length, removed: removed.length, dryRun: !apply }
  log(JSON.stringify(summary))
  return summary
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await pruneDeployments({ request: vercelRequest(process.env.VERCEL_TOKEN), apply: process.argv.includes('--apply') })
}
