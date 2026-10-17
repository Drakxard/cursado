// Shared, versioned wire contract. No credentials or browser state belong here.
export type LibraryFile = { id: string; path: string; hash: string; size: number; mime: string }
export type LibraryItem = { id: string; title: string; kind: string; subjectId?: string; week?: number; section?: string; fileId?: string; text?: string; important?: boolean }
export type LibraryManifest = { version: 1; workspaceId: string; revision: string; publishedAt: string; name: string; subjects: { id: string; name: string; color: string; weekday?: number }[]; items: LibraryItem[]; files: LibraryFile[] }
export const LIBRARY_STATE_PATH = 'manifests/workspace-library-sync.json'
export const LIBRARY_ROOTS = ['cronograma', 'teoria', 'practica', 'audio', 'sintesis', 'manifests', 'progreso']
export function libraryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) throw new Error('Identificador de biblioteca inválido.')
  return value
}
export function libraryHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Huella inválida.')
  return value
}
export function isLibraryPath(path: string) {
  if (path.length > 1000 || /[\\\x00-\x1f]/.test(path)) return false
  const parts = path.split('/')
  if (parts.length < 2 || parts.some(p => !p || p === '.' || p === '..' || /^User\./i.test(p))) return false
  if (parts[0] === 'boards') return parts.length === 2 && /\.(json|bin)$/.test(parts[1])
  if (parts[0] === 'progreso') return path === 'progreso/importantes.json' || /^progreso\/pizarras\/[a-zA-Z0-9-]{1,100}\.json$/.test(path)
  if (!LIBRARY_ROOTS.includes(parts[0])) return false
  if (parts.some(p => /^(?:copias|migracion-navegador|migration|provider|pairings|devices)$/i.test(p)) || /(?:\.backup\.|\.pre-reconciliation\.)/i.test(path)) return false
  if (parts[0] !== 'manifests') return true
  return /^manifests\/(?:materials\/|entries\/|sintesis\/|pdf-explanations\/|inscreen\/(?:sintesis\/|material-state\/|focused-notes\/|page-captures\/)|(?:workspace-state|subject-catalog|tags|material-containers|subject-shortcuts|subject-completions|cronograma|sessions)\.json$)/.test(path)
}
export function validateLibraryManifest(input: unknown): LibraryManifest {
  const m = input as LibraryManifest
  if (!m || m.version !== 1) throw new Error('Versión de biblioteca incompatible.')
  libraryId(m.workspaceId); libraryId(m.revision)
  if (!Number.isFinite(Date.parse(m.publishedAt)) || typeof m.name !== 'string' || m.name.length > 160) throw new Error('Biblioteca inválida.')
  if (!Array.isArray(m.files) || m.files.length > 50000 || !Array.isArray(m.items) || m.items.length > 100000 || !Array.isArray(m.subjects) || m.subjects.length > 1000) throw new Error('Inventario inválido.')
  const ids = new Set<string>(), paths = new Set<string>()
  for (const f of m.files) {
    libraryHash(f.id); libraryHash(f.hash)
    if (!isLibraryPath(f.path) || ids.has(f.id) || paths.has(f.path) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > 20 * 1024 ** 3 || typeof f.mime !== 'string' || f.mime.length > 160) throw new Error('Archivo de biblioteca inválido.')
    ids.add(f.id); paths.add(f.path)
  }
  const itemIds = new Set<string>()
  for (const item of m.items) {
    if (!item || typeof item.id !== 'string' || item.id.length > 240 || itemIds.has(item.id) || typeof item.title !== 'string' || item.title.length > 1000 || typeof item.kind !== 'string' || (item.fileId && !ids.has(item.fileId)) || (item.text && (typeof item.text !== 'string' || item.text.length > 2_000_000))) throw new Error('Elemento inválido.')
    itemIds.add(item.id)
  }
  for (const s of m.subjects) if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.color !== 'string') throw new Error('Materia inválida.')
  return m
}
