import { formatDateKey, getCurrentWeekNumber, getWeekDates } from '../subject-utils.ts'
import type { Json } from '../cooperation-model.ts'

type SelectionResource = { key: string; type: string; value?: Json; blob?: { hash: string } }
export type WeekSelection = { choosing: boolean; excludedWeeks: number[]; weeks: number[] }

export function resourceWeek(resource: SelectionResource): number | undefined {
  const path = resource.key.match(/(?:^|\/)(?:week-|semana-)(\d+)(?:[/.]|$)/)
  if (path) return Number(path[1])
  const value = resource.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const week = value.cooperationWeekNumber ?? value.weekNumber ?? value.week_number
    if (typeof week === 'number' && Number.isInteger(week) && week >= 0) return week
  }
}

/** Build a dependency closure so PDFs, board images and derived PDF data follow their week. */
export async function selectionResources(resources: Record<string, SelectionResource>, excludedWeeks: number[]) {
  const entries = Object.entries(resources), owners = new Map<string, Set<number>>()
  const weeks = new Set<number>(), materialWeeks = new Map<string, Set<number>>()
  const strings = (value: unknown, output: string[] = []): string[] => {
    if (typeof value === 'string') output.push(value)
    else if (Array.isArray(value)) value.forEach(v => strings(v, output))
    else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, output))
    return output
  }
  for (const [key, resource] of entries) {
    const week = resourceWeek(resource)
    owners.set(key, new Set(week === undefined ? [] : [week]))
    if (week !== undefined) {
      weeks.add(week)
      const value = resource.value as { materials?: { id: Json }[] } | undefined
      for (const material of value?.materials || []) {
        const id = String(material.id), set = materialWeeks.get(id) || new Set<number>()
        set.add(week); materialWeeks.set(id, set)
      }
    }
  }
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('')
  // Recover the week of legacy empty boards from the same deterministic IDs as Estudio.
  const legacyBoards = new Set(entries.filter(([key, r]) => /^progreso\/pizarras\/study-[a-f0-9]{64}\.json$/.test(key) && resourceWeek(r) === undefined).map(([key]) => key))
  const subject = resources['sphere.json']?.value as { subjectId?: string } | undefined
  const containers = resources['scope/containers.json']?.value
  const containerIds: (string | number)[] = ['theory', 'practice', ...(Array.isArray(containers) ? containers.flatMap(c => c && typeof c === 'object' && !Array.isArray(c) && (typeof c.id === 'string' || typeof c.id === 'number') ? [c.id] : []) : [])]
  const globalBoards = new Set<string>()
  if (legacyBoards.size && subject?.subjectId) {
    for (const id of containerIds) {
      const pinned = `progreso/pizarras/study-${await hash(JSON.stringify([subject.subjectId, id, 'pinned']))}.json`
      if (legacyBoards.has(pinned)) globalBoards.add(pinned)
      const candidateWeeks = [...new Set([...weeks, ...Array.from({ length: getCurrentWeekNumber() + 9 }, (_, i) => i)])]
      for (const week of candidateWeeks) for (const scope of [week, ...getWeekDates(week).map(formatDateKey)]) {
        const key = `progreso/pizarras/study-${await hash(JSON.stringify([subject.subjectId, id, scope]))}.json`
        if (legacyBoards.has(key)) { owners.get(key)!.add(week); weeks.add(week) }
      }
    }
  }
  for (const key of globalBoards) for (const week of weeks) owners.get(key)!.add(week)
  const links = new Map<string, Set<string>>()
  for (const [key, resource] of entries) {
    const refs = strings(resource.value), targets = new Set<string>()
    for (const ref of refs) {
      if (ref.startsWith('workspace://')) {
        const path = ref.slice(12), uriHash = await hash(ref), fileHash = resources[path]?.blob?.hash
        targets.add(path)
        for (const [candidate] of entries) if (candidate.startsWith(`manifests/pdf-explanations/${uriHash}/`) || (fileHash && candidate.includes(`/${fileHash}/`))) targets.add(candidate)
      }
      if (ref.startsWith('cooperation-asset:')) targets.add(`scope/board-assets/${ref.slice(18)}`)
      if (ref.startsWith('synthesis-local-image:')) for (const [candidate] of entries) if (candidate.startsWith('sintesis/images/') && candidate.includes(ref.slice(22))) targets.add(candidate)
      if (resources[ref]) targets.add(ref)
    }
    links.set(key, targets)
    // Older board files carry PDF references instead of an explicit week number.
    if (key.startsWith('progreso/pizarras/') && resourceWeek(resource) === undefined) {
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        if ('materialId' in value) for (const week of materialWeeks.get(String(value.materialId)) || []) owners.get(key)!.add(week)
        Object.values(value).forEach(visit)
      }
      visit(resource.value)
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [key, targets] of links) for (const target of targets) for (const week of owners.get(key) || []) {
      const set = owners.get(target)
      if (set && !set.has(week)) { set.add(week); changed = true }
    }
  }
  const excluded = new Set(excludedWeeks)
  const allowed = new Set(entries.filter(([key, resource]) => {
    const set = owners.get(key)!
    if (set.size) return [...set].some(week => !excluded.has(week))
    // Unassigned binary files and legacy boards cannot be assigned to a week safely.
    return key === 'sphere.json' || key.startsWith('scope/') && !resource.blob || globalBoards.has(key) && [...weeks].some(w => !excluded.has(w))
  }).map(([key]) => key))
  const materialIds = new Set([...materialWeeks].filter(([, weeks]) => [...weeks].some(w => !excluded.has(w))).map(([id]) => id))
  return { allowed, materialIds, weeks: [...weeks].sort((a,b) => a-b) }
}

export function projectSelectionTags(value: Json | undefined, materialIds: Set<string>): Json | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const assignments = Object.fromEntries(Object.entries((value.assignments || {}) as Record<string, Json>).filter(([id]) => materialIds.has(id)))
  const used = new Set(Object.values(assignments).flatMap(v => Array.isArray(v) ? v.map(String) : []))
  return { ...value, assignments, regions: Object.fromEntries(Object.entries((value.regions || {}) as Record<string, Json>).filter(([id]) => materialIds.has(id.split(':')[0]))), tags: (Array.isArray(value.tags) ? value.tags : []).filter(tag => tag && typeof tag === 'object' && !Array.isArray(tag) && used.has(String(tag.id))) }
}
