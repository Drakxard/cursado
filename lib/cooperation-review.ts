import { mergeCooperation, type Json } from './cooperation-model.ts'

const record = (value: unknown): value is Record<string, Json> => !!value && typeof value === 'object' && !Array.isArray(value)
export function cooperationDeletionName(pending: { label: string; key: string; value?: Json }) {
  const value = record(pending.value) ? pending.value : {}
  for (const field of ['file_name', 'name', 'custom_title', 'title', 'text_content', 'text', 'label']) {
    if (typeof value[field] === 'string' && value[field].trim()) return value[field].trim()
  }
  if (pending.label && pending.label !== 'Elemento') return pending.label
  if (typeof value.file === 'string') return value.file.split('/').at(-1)!
  if (pending.key === 'scope/containers.json') return 'Contenedor sin título'
  const week = pending.key.match(/week-(\d+)/)?.[1]
  return week ? `Contenido de semana ${week}` : pending.key.split('/').at(-1)!
}

// Keep genuine recovered edits available; old automatic metadata conflicts and
// independent additions need no user decision. Their recovery files stay intact.
export function hasMeaningfulCooperationRecovery(entry: Json): boolean {
  if (!record(entry) || !Array.isArray(entry.conflicts)) return true
  return entry.conflicts.some(conflict => {
    if (!record(conflict)) return true
    const path = Array.isArray(conflict.path) ? conflict.path.map(String) : []
    if (['updatedAt', 'updated_at', 'createdAt', 'created_at', 'revision', 'materialCount'].includes(path.at(-1) || '')) return false
    if (entry.key === 'scope/containers.json' && ['subjectId', 'subject_id'].includes(path.at(-1) || '')) return false
    const remaining: Parameters<typeof mergeCooperation>[3] = []
    mergeCooperation(undefined, conflict.local, conflict.remote, remaining, path)
    return remaining.length > 0
  })
}
