import { getCurrentWeekNumber, getWeekNumberForDate, parseDateKey } from './subject-utils.ts'

export type StudyBoardLocation = { boardId: string; name: string; cooperationSubjectId?: string; cooperationWeekNumber?: number }
export type StudySubjectLocation = { subjectId: string; date: string | null; section: 'theory' | 'exercises'; weekly: boolean }
export type StudyLocation = ReturnType<typeof parseStudyLocation>
type RouteCatalog = Record<string, { query: string; key: string }>
const routeFile = 'progreso/rutas-estudio.json'
let routes: RouteCatalog = {}, currentQuery: string | null = null
let workspace: FileSystemDirectoryHandle | null = null, readOnly = false
let saves: Promise<unknown> = Promise.resolve()
let boardHints: Record<string, { subject: string; week: string; name: string }> = {}
let subjectNames: Record<string, string> = {}
export const flushStudyRoutes = async () => { await saves }
export function setStudyBoardRouteHint(id: string, hint: { subject: string; week: string; name: string }) { boardHints[id] = hint }

export const studySlug = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'pizarra'
export const isStudyPath = (path: string) => path === '/estudio' || path === '/imp' || /^\/materia\/[^/]+$/.test(path) || /^\/pizarra\/[^/]+\/[^/]+\/[^/]+$/.test(path)

const short = (value: string | null, limit = 200) => value && value.length <= limit ? value : null
function dateKey(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

function parseStudyLocation(search: string) {
  const params = new URLSearchParams(search), subjectId = short(params.get('materia'))
  const boardId = params.get('pizarra'), week = params.get('semanaPizarra')
  const subject: StudySubjectLocation | null = subjectId ? {
    subjectId, date: dateKey(params.get('fecha')), section: params.get('seccion') === 'theory' ? 'theory' : 'exercises', weekly: params.get('alcance') === 'semana',
  } : null
  const board: StudyBoardLocation | null = boardId && /^[a-zA-Z0-9-]{1,100}$/.test(boardId) ? {
    boardId, name: short(params.get('nombrePizarra'), 500) || 'Pizarra',
    cooperationSubjectId: short(params.get('materiaPizarra')) || undefined,
    cooperationWeekNumber: week && /^\d{1,4}$/.test(week) ? Number(week) : undefined,
  } : null
  return { subject, board, tab: short(params.get('pestana')), important: params.get('importantes') === '1' }
}

export function readStudyLocation(search: string) {
  if (typeof window === 'undefined' || !isStudyPath(location.pathname)) return parseStudyLocation(search)
  return parseStudyLocation(currentQuery ?? routes[location.pathname]?.query ?? (location.pathname === '/imp' ? '?importantes=1' : search))
}

export function studyLocationPath(state: StudyLocation, hints?: { subject: string; week: string; name: string }) {
  if (state.board) {
    const parts = state.board.name.split(/\s+[·–—-]\s+/)
    const subject = hints?.subject || subjectNames[state.board.cooperationSubjectId || ''] || parts[0]
    const week = state.board.cooperationWeekNumber == null ? hints?.week || String(state.subject?.date ? getWeekNumberForDate(parseDateKey(state.subject.date)) : getCurrentWeekNumber()) : String(state.board.cooperationWeekNumber)
    return `/pizarra/${studySlug(subject)}/${studySlug(week)}/${studySlug(hints?.name || parts.slice(1).join(' - ') || state.board.name)}`
  }
  if (state.important) return '/imp'
  if (state.subject) return `/materia/${studySlug(subjectNames[state.subject.subjectId] || state.subject.subjectId)}`
  return '/estudio'
}

function locationKey(state: StudyLocation) { return state.board ? `board:${state.board.boardId}` : state.subject && !state.important ? `subject:${state.subject.subjectId}` : state.important ? 'important' : 'study' }

export async function resolveStudyLocation(root: FileSystemDirectoryHandle, options: { readOnly?: boolean } = {}) {
  workspace = root; readOnly = !!options.readOnly
  const { readWorkspaceJson } = await import('./workspace-json.ts')
  const saved = await readWorkspaceJson<{ version: number; routes: RouteCatalog }>(root, routeFile, { version: 1, routes: {} }, true)
  routes = saved?.version === 1 && saved.routes && typeof saved.routes === 'object' ? saved.routes : {}
  const state = await readWorkspaceJson<{ activeWorkspaceTabId?: string; customSubjects?: Record<string, { name: string; tabId?: string }> }>(root, 'manifests/workspace-state.json', {}, true)
  subjectNames = Object.fromEntries(Object.entries(state.customSubjects || {}).map(([id, subject]) => [id, subject.name]))
  const { readImportantTasks } = await import('./important-tasks.ts')
  boardHints = {}
  for (const task of await readImportantTasks(root).catch(() => [])) for (const [index, id] of (task.topicBoardIds || []).entries()) {
    boardHints[id] = { subject: task.text, week: String(getWeekNumberForDate(parseDateKey(task.dueDate))), name: task.topics[index] || task.text }
  }
  const path = location.pathname
  let cached: { query?: string; key?: string } | undefined = history.state?.studyRoute?.path === path ? history.state.studyRoute : undefined
  if (!cached) { try { cached = JSON.parse(sessionStorage.getItem(`study-route:${path}`) || 'null') || undefined } catch { /* Disk catalog remains authoritative. */ } }
  const disk = routes[path]
  const query = cached?.query && (!disk || cached.key === disk.key) ? cached.query : disk?.query
  const legacy = new URLSearchParams(location.search)
  if ([...legacy.keys()].some(key => locationKeys.includes(key as LocationKey))) currentQuery = location.search
  else if (query !== undefined) currentQuery = query
  else if (path === '/imp') currentQuery = '?importantes=1'
  else if (path === '/estudio') currentQuery = ''
  else if (!isStudyPath(path)) currentQuery = location.search
  else {
    // Existing folders and read-only publications can resolve visible names even
    // before their first short route has been registered.
    const subjects = Object.entries(state.customSubjects || {}).filter(([, subject]) => path === `/materia/${studySlug(subject.name)}`)
    const boards = Object.entries(boardHints).filter(([, hint]) => path === `/pizarra/${studySlug(hint.subject)}/${studySlug(hint.week)}/${studySlug(hint.name)}`)
    if (subjects.length === 1) {
      const [id, subject] = subjects[0]
      currentQuery = new URLSearchParams({ materia: id, pestana: subject.tabId || state.activeWorkspaceTabId || 'main', alcance: 'semana' }).toString()
    } else if (boards.length === 1) {
      const [id, hint] = boards[0]
      currentQuery = new URLSearchParams({ pizarra: id, nombrePizarra: `${hint.subject} · ${hint.name}`, importantes: '1' }).toString()
    } else throw new Error('No se encontró esta ubicación en la carpeta vinculada.')
  }
  return parseStudyLocation(currentQuery)
}

type LocationKey = 'materia' | 'fecha' | 'seccion' | 'alcance' | 'pestana' | 'pizarra' | 'nombrePizarra' | 'materiaPizarra' | 'semanaPizarra' | 'importantes'
const locationKeys: LocationKey[] = ['materia', 'fecha', 'seccion', 'alcance', 'pestana', 'pizarra', 'nombrePizarra', 'materiaPizarra', 'semanaPizarra', 'importantes']
export function updateStudyLocation(values: Partial<Record<LocationKey, string | null>>) {
  // Embedded libraries have their own owner and must not change the outer route.
  if (typeof window === 'undefined' || window.parent !== window || !isStudyPath(location.pathname)) return
  const url = new URL(location.href)
  const params = new URLSearchParams(currentQuery ?? location.search)
  for (const [key, value] of Object.entries(values)) {
    if (value === null) params.delete(key)
    else if (value !== undefined) params.set(key, value)
  }
  currentQuery = params.toString()
  const state = parseStudyLocation(currentQuery), key = locationKey(state)
  const base = studyLocationPath(state, state.board ? boardHints[state.board.boardId] : undefined)
  // A week distinguishes recurring boards; a numeric suffix also handles two
  // boards with exactly the same title within the same subject and week.
  let path = base, suffix = 2
  while (routes[path] && routes[path].key !== key) path = `${base}-${suffix++}`
  const record = { query: currentQuery, key }
  routes[path] = record
  try { sessionStorage.setItem(`study-route:${path}`, JSON.stringify(record)) } catch { /* The folder still retains the route. */ }
  url.pathname = path
  for (const key of locationKeys) url.searchParams.delete(key)
  history.replaceState({ ...history.state, studyRoute: { ...record, path } }, '', url)
  if (workspace && !readOnly) {
    const root = workspace
    saves = saves.catch(() => {}).then(async () => {
      const [{ readWorkspaceJson, writeWorkspaceJson }, { withWorkspaceFileLock }] = await Promise.all([import('./workspace-json.ts'), import('./workspace-file-lock.ts')])
      await withWorkspaceFileLock('study-route-catalog', async () => {
        const latest = await readWorkspaceJson<{ version: number; routes: RouteCatalog }>(root, routeFile, { version: 1, routes: {} }, true)
        const catalog = latest.routes || {}
        const previousPath = path
        while (catalog[path] && catalog[path].key !== key) path = `${base}-${suffix++}`
        if (path !== previousPath) {
          routes[path] = record
          if (history.state?.studyRoute?.path === previousPath && history.state.studyRoute.key === key) {
            const corrected = new URL(location.href); corrected.pathname = path
            history.replaceState({ ...history.state, studyRoute: { ...record, path } }, '', corrected)
            try { sessionStorage.setItem(`study-route:${path}`, JSON.stringify(record)) } catch { /* Disk still retains the route. */ }
          }
        }
        if (catalog[path]?.query !== record.query) await writeWorkspaceJson(root, routeFile, { version: 1, routes: { ...catalog, [path]: record } })
      })
    })
    void saves.catch(error => window.dispatchEvent(new CustomEvent('cursado-study-route-error', { detail: String(error) })))
  }
}

export function writeStudyBoardLocation(board: StudyBoardLocation | null) {
  updateStudyLocation({ pizarra: board?.boardId ?? null, nombrePizarra: board?.name ?? null,
    materiaPizarra: board?.cooperationSubjectId ?? null, semanaPizarra: board?.cooperationWeekNumber == null ? null : String(board.cooperationWeekNumber) })
}
