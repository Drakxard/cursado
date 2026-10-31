export type StudyBoardLocation = { boardId: string; name: string; cooperationSubjectId?: string; cooperationWeekNumber?: number }
export type StudySubjectLocation = { subjectId: string; date: string | null; section: 'theory' | 'exercises'; weekly: boolean }

const short = (value: string | null, limit = 200) => value && value.length <= limit ? value : null
function dateKey(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

export function readStudyLocation(search: string) {
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

type LocationKey = 'materia' | 'fecha' | 'seccion' | 'alcance' | 'pestana' | 'pizarra' | 'nombrePizarra' | 'materiaPizarra' | 'semanaPizarra' | 'importantes'
export function updateStudyLocation(values: Partial<Record<LocationKey, string | null>>) {
  // Embedded libraries have their own owner and must not change the outer route.
  if (typeof window === 'undefined' || window.parent !== window || location.pathname !== '/estudio') return
  const url = new URL(location.href)
  for (const [key, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(key)
    else if (value !== undefined) url.searchParams.set(key, value)
  }
  if (url.href !== location.href) history.replaceState(history.state, '', url)
}

export function writeStudyBoardLocation(board: StudyBoardLocation | null) {
  updateStudyLocation({ pizarra: board?.boardId ?? null, nombrePizarra: board?.name ?? null,
    materiaPizarra: board?.cooperationSubjectId ?? null, semanaPizarra: board?.cooperationWeekNumber == null ? null : String(board.cooperationWeekNumber) })
}
