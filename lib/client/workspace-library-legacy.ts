'use client'
import { isLibraryPath } from '@/lib/workspace-library'
import { isLegacyLibraryKey, type LegacyLibraryCatalog } from '@/lib/workspace-library-legacy'

const recoveryPath = 'manifests/workspace-library-recovery.json'
type Recovery = { version: 1; finished: boolean; pending: string[]; sources: Record<string, string> }
async function handle(root: FileSystemDirectoryHandle, path: string, create = false) {
  const parts = path.split('/'); let dir = root
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create })
  return dir.getFileHandle(parts.at(-1)!, { create })
}
async function read(root: FileSystemDirectoryHandle, path: string) {
  try { return JSON.parse(await (await (await handle(root, path)).getFile()).text()) }
  catch (error) { if ((error as DOMException).name === 'NotFoundError') return null; throw error }
}
async function write(root: FileSystemDirectoryHandle, path: string, data: unknown) {
  const writer = await (await handle(root, path, true)).createWritable()
  try { await writer.write(JSON.stringify(data)); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
}
function merge(remote: unknown, local: unknown, aliases: Map<string, string>, field = ''): unknown {
  if (local == null) return remote
  if (Array.isArray(remote) && Array.isArray(local) && ['materials', 'entries'].includes(field)) {
    const result = [...local] as Record<string, unknown>[]
    for (const row of remote as Record<string, unknown>[]) {
      const existing = result.find(r => r.id === row.id || r.drive_file_id && r.drive_file_id === row.drive_file_id)
      if (!existing) result.push(row)
      else if (typeof row.drive_file_id === 'string' && typeof existing.drive_file_id === 'string' && row.drive_file_id.startsWith('workspace://') && existing.drive_file_id.startsWith('workspace://')) aliases.set(row.drive_file_id.slice(12), existing.drive_file_id.slice(12))
    }
    return result
  }
  if (remote && local && typeof remote === 'object' && typeof local === 'object' && !Array.isArray(remote) && !Array.isArray(local)) {
    const result = { ...remote } as Record<string, unknown>
    for (const [key, value] of Object.entries(local)) result[key] = merge(result[key], value, aliases, key)
    return result
  }
  return local
}
export async function recoverLegacyLibrary(root: FileSystemDirectoryHandle, options: {
  workspaceId: string
  api: (action: string, body: Record<string, unknown>, method?: string) => Promise<any>
  headers: () => Record<string, string>
  report: (message: string, bytesDone?: number, bytesTotal?: number) => void
}): Promise<Record<string, string>> {
  const state: Recovery = await read(root, recoveryPath) || { version: 1, finished: false, pending: [], sources: {} }
  if (state.version !== 1 || !Array.isArray(state.pending) || !state.sources || typeof state.sources !== 'object') throw new Error('El registro de recuperación anterior no es válido. Conservá una copia de manifests/workspace-library-recovery.json para revisar el problema.')
  if (state.finished) return state.sources
  options.report('Buscando la sincronización anterior de R2…')
  const catalog = await options.api('legacy/catalog', { workspaceId: options.workspaceId }, 'GET') as LegacyLibraryCatalog
  if (!Array.isArray(catalog.documents) || !Array.isArray(catalog.files)) throw new Error('No se pudo leer el inventario anterior de R2.')
  const aliases = new Map<string, string>(), documents = []
  for (const doc of catalog.documents) {
    if (!isLibraryPath(doc.path) || !doc.path.startsWith('manifests/')) throw new Error('Ruta de recuperación inválida.')
    documents.push({ path: doc.path, data: merge(doc.data, await read(root, doc.path), aliases) })
  }
  const references = new Set<string>()
  function collect(value: unknown) {
    if (typeof value === 'string' && value.startsWith('workspace://')) references.add(value.slice(12))
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  documents.forEach(doc => collect(doc.data))
  const recoverable = catalog.files.filter(file => references.has(aliases.get(file.path) || file.path) || file.path === file.key)
  const bytesTotal = recoverable.reduce((total, file) => total + file.size, 0)
  let bytesDone = 0
  for (const file of recoverable) {
    const path = aliases.get(file.path) || file.path
    if (!isLibraryPath(path) || !isLegacyLibraryKey(file.key)) throw new Error('Archivo de recuperación inválido.')
    if (!references.has(path) && path !== file.key) continue
    let exists = false
    try { await (await handle(root, path)).getFile(); exists = true } catch (error) { if ((error as DOMException).name !== 'NotFoundError') throw error }
    if (!exists || state.pending.includes(path)) {
      options.report(`Recuperando ${path} desde R2…`, bytesDone, bytesTotal)
      if (!state.pending.includes(path)) state.pending.push(path)
      await write(root, recoveryPath, state)
      const params = new URLSearchParams({ workspaceId: options.workspaceId, key: file.key })
      const response = await fetch(`/api/inscreen/workspace/legacy/object?${params}`, { headers: options.headers(), cache: 'no-store' })
      if (!response.ok || !response.body) throw new Error(`No se pudo recuperar ${path}. Reintentá; tus archivos locales se conservan.`)
      const writer = await (await handle(root, path, true)).createWritable()
      let received = 0
      try { await response.body.pipeThrough(new TransformStream({ transform(chunk, controller) { received += chunk.byteLength; options.report(`Recuperando ${path} desde R2…`, bytesDone + received, bytesTotal); controller.enqueue(chunk) } })).pipeTo(writer) }
      catch (error) { throw new Error((error as DOMException).name === 'QuotaExceededError' ? `No hay espacio suficiente para recuperar ${path}. Liberá espacio y reintentá; la recuperación conserva lo ya descargado.` : `Se interrumpió la recuperación de ${path}. Reintentá; tus archivos locales se conservan.`) }
      if ((await (await handle(root, path)).getFile()).size !== file.size) throw new Error(`La descarga de ${path} quedó incompleta. Reintentá.`)
      state.pending = state.pending.filter(p => p !== path)
    }
    state.sources[path] = file.key
    bytesDone += file.size
    options.report('Revisando la biblioteca recuperada…', bytesDone, bytesTotal)
    await write(root, recoveryPath, state)
  }
  for (const doc of documents) await write(root, doc.path, doc.data)
  state.finished = true; await write(root, recoveryPath, state)
  return state.sources
}
