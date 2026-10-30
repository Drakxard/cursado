/** Shared, deterministic merge rules used by the Worker and the local mirror. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export const COOPERATIVE_TAB_ID = 'cooperative'
export type Conflict = { path: string[]; local: Json; remote: Json }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)
const keyed = (v: Json[]): boolean => v.every(x => object(x) && (typeof x.id === 'string' || typeof x.id === 'number')) && new Set(v.map(x => (x as Record<string, Json>).id)).size === v.length
export function mergeCooperation(base: Json | undefined, local: Json | undefined, remote: Json | undefined,
  conflicts: Conflict[] = [], path: string[] = []): Json | undefined {
  if (Array.isArray(local) && Array.isArray(remote) && (local.some(row => object(row) && (row.kind === 'theory' || row.kind === 'practice')) || remote.some(row => object(row) && (row.kind === 'theory' || row.kind === 'practice')))) {
    // Teoría/Práctica are fixed containers. A device may have created its local
    // defaults before receiving the original ids; this is not a delete + add.
    const defaults = new Map<string, Json>()
    for (const row of [...(Array.isArray(base) ? base : []), ...remote, ...local]) if (object(row) && (row.kind === 'theory' || row.kind === 'practice') && !defaults.has(row.kind)) defaults.set(row.kind, row.id)
    if (defaults.size) {
      const normalize = (rows: Json[]) => {
        const seen = new Set<string>()
        return rows.flatMap(row => {
          if (!object(row) || (row.kind !== 'theory' && row.kind !== 'practice')) return [row]
          if (seen.has(row.kind)) return []
          seen.add(row.kind)
          return [{ ...row, id: defaults.get(row.kind)! }]
        })
      }
      local = normalize(local); remote = normalize(remote)
      if (Array.isArray(base)) base = normalize(base)
    }
  }
  if (equal(base, local)) return remote
  if (equal(base, remote) || equal(local, remote)) return local
  if (['updatedAt', 'updated_at', 'revision'].includes(path.at(-1) || '')) {
    if (typeof local === 'number' && typeof remote === 'number') return Math.max(local, remote)
    if (typeof local === 'string' && typeof remote === 'string') return local > remote ? local : remote
  }
  if (['createdAt', 'created_at'].includes(path.at(-1) || '') && typeof local === 'string' && typeof remote === 'string') return local < remote ? local : remote
  // A committed deletion cannot be undone by a stale edit.
  if (base !== undefined && (local === undefined || remote === undefined)) return undefined
  // Synthesis stores a heading and its body as adjacent Tiptap blocks. Merge
  // those sections independently so editing two subjects cannot replace a doc.
  if (object(base) && object(local) && object(remote) && base.type === 'doc' && local.type === 'doc' && remote.type === 'doc') {
    const sections = (doc: Record<string, Json>): Json[] => {
      const result: { id: string; blocks: Json[] }[] = []
      for (const block of (doc.content || []) as Json[]) {
        const id = object(block) && block.type === 'heading' && object(block.attrs) && block.attrs.level === 1 ? block.attrs.synthesisId : undefined
        if (typeof id === 'string') result.push({ id, blocks: [] })
        if (!result.length) result.push({ id: '__preamble', blocks: [] })
        result.at(-1)!.blocks.push(block)
      }
      return result
    }
    const merged = mergeCooperation(sections(base), sections(local), sections(remote), conflicts, [...path, 'sections']) as { id: string; blocks: Json[] }[]
    return { ...remote, ...local, content: merged.flatMap(section => section.blocks) }
  }
  if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base) && keyed(base)) && keyed(local) && keyed(remote)) {
    const index = (rows: Json[]) => new Map(rows.map(row => [String((row as Record<string, Json>).id), row]))
    const b = index(base || []), l = index(local), r = index(remote), result: Json[] = []
    for (const id of new Set([...r.keys(), ...l.keys()])) {
      const before = conflicts.length
      const value = mergeCooperation(b.get(id), l.get(id), r.get(id), conflicts, [...path, `@${id}`])
      if (value !== undefined) result.push(value)
      // Offline edits of the same canvas object remain visible side by side.
      if (conflicts.length > before && object(l.get(id)) && object(r.get(id)) && typeof (l.get(id) as Record<string, Json>).x === 'number') {
        const copy = structuredClone(l.get(id)) as Record<string, Json>
        copy.id = `${id}-recovered-${fingerprint(copy)}`
        copy.x = Number(copy.x) + Number(copy.width || 300) + 40
        if (!result.some(row => object(row) && row.id === copy.id)) result.push(copy)
      }
    }
    return result
  }
  if (object(local) && object(remote) && (object(base) || base === undefined)) {
    const result: Record<string, Json> = {}
    for (const key of new Set([...Object.keys(remote), ...Object.keys(local)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
      const value = mergeCooperation(object(base) ? base[key] : undefined, local[key], remote[key], conflicts, [...path, key])
      if (value !== undefined) result[key] = value
    }
    return result
  }
  conflicts.push({ path, local: local ?? null, remote: remote ?? null })
  return local
}
function fingerprint(value: Json) {
  let hash = 2166136261
  for (const c of JSON.stringify(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(16)
}
export function parseCooperationNames(value: unknown): string[] {
  if (typeof value !== 'string') throw new Error('Escribí entre 1 y 20 nombres de usuario separados por comas.')
  const names = value.trim().replace(/^\[/, '').replace(/\]$/, '').split(',').map(x => x.trim()).filter(Boolean)
  if (!names.length || names.length > 20) throw new Error('Escribí entre 1 y 20 nombres de usuario separados por comas.')
  const normalized = names.map(x => x.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '))
  if (new Set(normalized).size !== names.length) throw new Error('Hay nombres de usuario repetidos.')
  return names
}
export function safeCooperationPath(path: string) {
  return typeof path === 'string' && path.length <= 1000 && !/[\\\u0000-\u001f]/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..' && !['__proto__', 'constructor', 'prototype'].includes(p))
}
