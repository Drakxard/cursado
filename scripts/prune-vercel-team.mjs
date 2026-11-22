import { listProjectDeployments, pruneDeployments, teamId } from './prune-vercel-deployments.mjs'

async function listTeamProjects(request) {
  const projects = new Map(), cursors = new Set()
  let cursor
  do {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('from', String(cursor))
    const page = await request(`/v10/projects?${query}`)
    if (!Array.isArray(page.projects)) throw new Error('Lista de proyectos inválida')
    for (const project of page.projects) {
      if (project.accountId !== teamId || !/^prj_[a-zA-Z0-9]+$/.test(project.id)) throw new Error('Proyecto fuera del equipo autorizado')
      projects.set(project.id, project)
    }
    cursor = page.pagination?.next
    if (cursor && cursors.has(cursor)) throw new Error('La paginación de proyectos no avanzó')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return [...projects.values()]
}

async function liveDomain(request, project) {
  const names = new Set(project.targets?.production?.alias || [])
  const cursors = new Set()
  let cursor
  do {
    const query = new URLSearchParams({ production: 'true', limit: '100' })
    if (cursor) query.set('until', String(cursor))
    const page = await request(`/v9/projects/${project.id}/domains?${query}`)
    if (!Array.isArray(page.domains)) throw new Error('Lista de dominios inválida')
    for (const domain of page.domains) if (!domain.gitBranch && !domain.redirect) names.add(domain.name)
    cursor = page.pagination?.next
    if (cursor && cursors.has(cursor)) throw new Error('La paginación de dominios no avanzó')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  const active = new Map()
  for (const name of names) {
    try {
      const alias = await request(`/v4/aliases/${encodeURIComponent(name)}`)
      const id = alias.deploymentId || alias.deployment?.id
      if (alias.projectId !== project.id || !/^dpl_[a-zA-Z0-9]+$/.test(id || '')) throw new Error('Dominio fuera del proyecto autorizado')
      active.set(name, id)
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }
  if (new Set(active.values()).size > 1) throw new Error('Hay dominios activos en distintas versiones; se conservaron todos')
  const domains = [...active.keys()]
  return domains.length ? { domain: domains[0], domains } : null
}

async function pruneFailedProject(request, project, deployments, apply) {
  // Without a live domain, never delete a READY deployment. For projects that
  // never built successfully, keep their latest attempt and remove older failures.
  if (deployments.some(d => (d.readyState || d.state) === 'READY')) {
    return { active: null, total: deployments.length, candidates: 0, removed: 0, skipped: 'Sin dominio activo verificable', dryRun: !apply }
  }
  const latest = [...deployments].sort((a, b) => (b.createdAt ?? b.created) - (a.createdAt ?? a.created))[0]
  const failures = new Set(['ERROR', 'CANCELED', 'BLOCKED'])
  let candidates = 0, removed = 0
  for (const deployment of deployments) {
    if (deployment.uid === latest?.uid || !failures.has(deployment.readyState || deployment.state)) continue
    candidates++
    if (!apply) continue
    const owner = await request(`/v9/projects/${project.id}`)
    const detail = await request(`/v13/deployments/${deployment.uid}`)
    if (owner.id !== project.id || owner.accountId !== teamId || detail.id !== deployment.uid ||
        detail.projectId !== project.id || !failures.has(detail.readyState)) throw new Error('El despliegue cambió; limpieza detenida')
    await request(`/v13/deployments/${deployment.uid}`, 'DELETE')
    removed++
  }
  return { active: latest?.uid || null, total: deployments.length, candidates, removed, dryRun: !apply }
}

export async function pruneTeamDeployments({ request, apply = false, log = console.log }) {
  const projects = await listTeamProjects(request)
  const results = [], errors = []
  for (const project of projects) {
    try {
      const deployments = await listProjectDeployments(request, project.id)
      let result
      // A project with zero or one deployment has no history to remove. Avoid
      // resolving every domain on every scheduled pass when nothing can change.
      if (deployments.length <= 1) result = { active: deployments[0]?.uid || null, total: deployments.length, candidates: 0, removed: 0, dryRun: !apply }
      else {
        const live = await liveDomain(request, project)
        result = live
          ? await pruneDeployments({ request, apply, log, scope: { projectId: project.id, ...live } })
          : await pruneFailedProject(request, project, deployments, apply)
      }
      results.push({ projectId: project.id, name: project.name, ...result })
    } catch (error) {
      errors.push({ projectId: project.id, name: project.name, error: error.message })
    }
  }
  const summary = { teamId, projects: results, errors, removed: results.reduce((n, p) => n + p.removed, 0), dryRun: !apply }
  log(JSON.stringify(summary))
  return summary
}
