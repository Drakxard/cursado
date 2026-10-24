'use client'
import { safeCooperationPath, type Json } from '../cooperation-model.ts'
import { withWorkspaceFileLock } from '../workspace-file-lock.ts'
import { readWorkspaceJson, writeWorkspaceJson } from '../workspace-json.ts'

export type SphereBinding = { id: string; groupId: string; subjectId: string; storageKey: string; sourceId: string; sourceKey: string; name: string; color: string; owner: boolean; pathAliases?: Record<string, string>; numberAliases?: Record<string, number> }
export type MirrorFile = { key: string; value?: Json; blob?: Blob }
export const digest = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('')
export async function directory(root: FileSystemDirectoryHandle, parts: string[], create = false) {
  let dir = root
  for (const part of parts) { if (!safeCooperationPath(part) || part.includes('/')) throw new Error('Ruta local inválida.'); dir = await dir.getDirectoryHandle(part, { create }) }
  return dir
}
export async function readFile(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  if (!safeCooperationPath(path)) throw new Error('Ruta local inválida.')
  try { const parts = path.split('/'); return await (await (await directory(root, parts.slice(0, -1))).getFileHandle(parts.at(-1)!)).getFile() }
  catch (error) { if ((error as Error).name === 'NotFoundError') return null; throw error }
}
export async function readJson<T>(root: FileSystemDirectoryHandle, path: string, fallback: T): Promise<T> {
  if (!safeCooperationPath(path)) throw new Error('Ruta local inválida.')
  return readWorkspaceJson(root, path, fallback)
}
export async function writeFile(root: FileSystemDirectoryHandle, path: string, blob: Blob) {
  if (!safeCooperationPath(path)) throw new Error('Ruta local inválida.')
  return withWorkspaceFileLock(`write:${path}`, async () => {
    const parts = path.split('/'), dir = await directory(root, parts.slice(0, -1), true)
    const file = await dir.getFileHandle(parts.at(-1)!, { create: true }), writer = await file.createWritable()
    try { await writer.write(blob); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
    if (await digest(await file.getFile()) !== await digest(blob)) throw new Error(`No se pudo verificar ${path}.`)
  })
}
export const writeJson = (root: FileSystemDirectoryHandle, path: string, value: unknown) => {
  if (!safeCooperationPath(path)) throw new Error('Ruta local inválida.')
  return writeWorkspaceJson(root, path, value)
}
export async function removeFile(root: FileSystemDirectoryHandle, path: string) {
  if (!safeCooperationPath(path)) throw new Error('Ruta local inválida.')
  const parts = path.split('/')
  try { await (await directory(root, parts.slice(0, -1))).removeEntry(parts.at(-1)!) }
  catch (error) { if ((error as Error).name !== 'NotFoundError') throw error }
}
async function walk(root: FileSystemDirectoryHandle, path: string): Promise<string[]> {
  let dir: FileSystemDirectoryHandle
  try { dir = await directory(root, path.split('/')) } catch (error) { if ((error as Error).name === 'NotFoundError') return []; throw error }
  const result: string[] = []
  for await (const [name, entry] of dir.entries()) {
    if (/backup|copias|migracion|migration|damaged|pending/i.test(name)) continue
    if (entry.kind === 'directory') result.push(...await walk(root, `${path}/${name}`))
    else result.push(`${path}/${name}`)
  }
  return result
}
export function mapBindingText(value: string, binding: SphereBinding, incoming: boolean) {
  const aliases = [...Object.entries(binding.pathAliases || {}), ...Object.entries(binding.numberAliases || {}).map(([key, value]) => [key, String(value)])]
  const pairs = incoming ? [...aliases, [binding.sourceId, binding.subjectId], [binding.sourceKey, binding.storageKey]] : [...aliases.map(([source, local]) => [local, source]), [binding.subjectId, binding.sourceId], [binding.storageKey, binding.sourceKey]]
  for (const [from, to] of pairs) {
    if (value === from) return to
    value = value.split('/').map(part => part === from ? to : part).join('/')
    if (/^\d+$/.test(from)) value = value.split(':').map(part => part === from ? to : part).join(':')
  }
  return value
}
export function mapBindingJson(value: Json, binding: SphereBinding, incoming: boolean, field = ''): Json {
  if (typeof value === 'number' && /^(?:id|.*_id|.*Id|assignments)$/.test(field)) {
    if (incoming) return binding.numberAliases?.[String(value)] ?? value
    return Number(Object.entries(binding.numberAliases || {}).find(([, local]) => local === value)?.[0] ?? value)
  }
  if (typeof value === 'string') return mapBindingText(value, binding, incoming)
  if (Array.isArray(value)) return value.map(v => mapBindingJson(v, binding, incoming, field))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [mapBindingText(key, binding, incoming), mapBindingJson(v, binding, incoming, field === 'assignments' ? field : key)]))
  return value
}
const ephemeral = new Set(['camera', 'selectedId', 'selection', 'r2', 'lastReadPage', 'scrollTop'])
function stripPersonal(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripPersonal)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !ephemeral.has(key)).map(([key, v]) => [key, stripPersonal(v)]))
  return value
}
export async function scanSphere(root: FileSystemDirectoryHandle, b: SphereBinding): Promise<MirrorFile[]> {
  const output: MirrorFile[] = [], paths = new Set<string>(), ids = new Set([b.subjectId, b.storageKey])
  const add = async (path: string, sharedPath = path) => {
    if (paths.has(path)) return
    if (!safeCooperationPath(path)) throw new Error('Una referencia de la esfera tiene una ruta inválida.')
    const scoped = sharedPath.split('/').some(part => ids.has(part) || ids.has(decodeURIComponent(part)))
    const derived = path.startsWith('manifests/pdf-explanations/') || path.startsWith('manifests/subject-voice/pdf/') || path.startsWith('sintesis/images/') || path.startsWith('progreso/pizarras/')
    if (!scoped && !derived) throw new Error(`La esfera referencia «${path}», fuera de su carpeta. Reubicá ese archivo en la materia antes de cooperar.`)
    paths.add(path)
    const blob = await readFile(root, path)
    if (!blob) return
    const key = mapBindingText(sharedPath, b, false)
    if (path.endsWith('.json')) {
      const raw = await readJson<Json | undefined>(root, path, undefined)
      if (raw === undefined) {
        if(path.startsWith('manifests/subject-voice/pdf/') || path.startsWith('manifests/pdf-explanations/'))return
        throw new Error(`El archivo local «${path}» está vacío. Completalo o restaurá su respaldo antes de compartir.`)
      }
      if (path.startsWith('progreso/pizarras/') && raw && typeof raw === 'object' && !Array.isArray(raw) && raw.assets && typeof raw.assets === 'object' && !Array.isArray(raw.assets)) {
        for (const [id, data] of Object.entries(raw.assets)) if (typeof data === 'string' && /^data:[^,]*;base64,/.test(data)) {
          const comma = data.indexOf(','), bytes = Uint8Array.from(atob(data.slice(comma + 1)), char => char.charCodeAt(0))
          const asset = new Blob([bytes], { type: data.slice(5, data.indexOf(';')) }), hash = await digest(asset)
          if (!output.some(file => file.key === `scope/board-assets/${hash}`)) output.push({ key: `scope/board-assets/${hash}`, blob: asset })
          raw.assets[id] = `cooperation-asset:${hash}`
        }
      }
      const shared=await isolateReferences(stripPersonal(raw))
      output.push({ key, value: mapBindingJson(shared, b, false) })
      await references(shared)
    } else output.push({ key, blob })
  }
  // Older imports can retain references to files outside the subject folder.
  // Publish only those explicit attachments, under deterministic subject paths.
  const isolateReferences = async (value: Json): Promise<Json> => {
    if (typeof value === 'string' && value.startsWith('workspace://')) {
      const path = value.slice(12)
      if (!safeCooperationPath(path)) throw new Error('Una referencia de la esfera tiene una ruta inválida.')
      if (path.split('/').some(part => ids.has(part) || ids.has(decodeURIComponent(part)))) return value
      if (!/^(?:teoria|practica|audio)\//.test(path) || path.endsWith('.json')) return value
      const sharedPath = `${path.split('/')[0]}/${b.storageKey}/cooperation-imports/${await digest(new Blob([path]))}/${path.split('/').at(-1)}`
      if (!await readFile(root, path)) throw new Error(`No se encuentra el archivo referenciado «${path}». Restauralo y reintentá la sincronización.`)
      await add(path, sharedPath)
      return `workspace://${sharedPath}`
    }
    if (Array.isArray(value)) return Promise.all(value.map(isolateReferences))
    if (value && typeof value === 'object') {
      const entries: [string, Json][] = []
      for (const [key, child] of Object.entries(value)) entries.push([key, await isolateReferences(child)])
      return Object.fromEntries(entries)
    }
    return value
  }
  const references = async (value: Json): Promise<void> => {
    if (typeof value === 'string') {
      if (/^[a-f0-9]{64}$/.test(value)) {
        for (const base of ['manifests/subject-voice/pdf/datalab-balanced-json-v1', 'manifests/subject-voice/pdf/corrections-v1']) for (const path of await walk(root, `${base}/${value}`)) await add(path)
      }
      if (value.startsWith('workspace://')) {
        await add(value.slice(12))
        const h = await digest(new Blob([value]))
        for (const path of await walk(root, `manifests/pdf-explanations/${h}`)) await add(path)
      }
      if (value.startsWith('synthesis-local-image:')) {
        const id = value.slice('synthesis-local-image:'.length)
        for (const path of await walk(root, 'sintesis/images')) if (path.includes(id)) await add(path)
      }
      if (/^(?:subject-voice|manifests\/subject-voice)\//.test(value)) await add(value)
    } else if (Array.isArray(value)) { for (const v of value) await references(v) }
    else if (value && typeof value === 'object') { for (const v of Object.values(value)) await references(v) }
  }
  for (const id of ids) {
    for (const base of ['teoria', 'practica', 'audio', 'sintesis', 'manifests/materials', 'manifests/entries', 'manifests/synthesis', 'manifests/sintesis', 'manifests/subject-voice', 'manifests/subject-voice/topics', 'manifests/subject-voice/search-history', 'subject-voice/topics', 'subject-voice/images', 'subject-voice/pdf-sources']) {
      for (const path of await walk(root, `${base}/${id}`)) await add(path)
    }
  }
  // PDF extraction, corrections and HTML are scoped by the PDF's content hash.
  for (const file of [...output]) if (file.blob && file.key.endsWith('.pdf')) {
    const hash = await digest(file.blob)
    for (const base of ['manifests/subject-voice/pdf/datalab-balanced-json-v1', 'manifests/subject-voice/pdf/corrections-v1']) for (const path of await walk(root, `${base}/${hash}`)) await add(path)
  }
  for (const path of await walk(root, 'progreso/pizarras')) {
    const board = await readJson<Record<string, Json>>(root, path, {})
    const text = JSON.stringify(board)
    if (ids.has(String(board.cooperationSubjectId)) || [...ids].some(id => text.includes(`"subjectId":"${id}"`)) || String(board.name || '').startsWith(`${b.name} - `)) await add(path)
  }
  const containers = await readJson<Record<string, Json[]>>(root, 'manifests/material-containers.json', {})
  output.push({ key: 'scope/containers.json', value: mapBindingJson([...ids].flatMap(id => containers[id] || []), b, false) })
  const shortcuts = await readJson<Record<string, Json>>(root, 'manifests/subject-shortcuts.json', {})
  const shortcut = shortcuts[b.storageKey] || shortcuts[b.subjectId]
  if (shortcut) output.push({ key: 'scope/shortcuts.json', value: mapBindingJson(shortcut, b, false) })
  // Tags are global locally; publish only assignments and definitions used by this sphere.
  const materialIds = new Set<string>()
  for (const item of output) if (item.key.startsWith('manifests/materials/') && item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
    for (const material of (item.value.materials || []) as Record<string, Json>[]) materialIds.add(String(material.id))
  }
  const tags = await readJson<{ tags: Record<string, Json>[]; assignments: Record<string, Json>; regions: Record<string, Json> }>(root, 'manifests/tags.json', { tags: [], assignments: {}, regions: {} })
  const assignments = Object.fromEntries(Object.entries(tags.assignments || {}).filter(([id]) => materialIds.has(id)))
  const tagIds = new Set(Object.values(assignments).flatMap(v => v as Json[]).map(String))
  output.push({ key: 'scope/tags.json', value: { tags: (tags.tags || []).filter(t => tagIds.has(String(t.id))), assignments, regions: Object.fromEntries(Object.entries(tags.regions || {}).filter(([key]) => materialIds.has(key.split(':')[0]))) } })
  return output
}
export async function applyMirrorFile(root: FileSystemDirectoryHandle, b: SphereBinding, key: string, value: Json | Blob) {
  if (key === 'sphere.json') return
  if (/^scope\/board-assets\/[a-f0-9]{64}$/.test(key) && value instanceof Blob) { await writeFile(root, `.cooperation/assets/${b.id}/${key.split('/').at(-1)}`, value); return }
  const mapped = value instanceof Blob ? value : mapBindingJson(value, b, true)
  if (key === 'scope/containers.json' || key === 'scope/shortcuts.json') {
    const path = key.includes('containers') ? 'manifests/material-containers.json' : 'manifests/subject-shortcuts.json'
    return withWorkspaceFileLock(`manifest:${path}`, async () => {
      const all = await readJson<Record<string, Json>>(root, path, {})
      all[b.storageKey] = mapped as Json
      await writeJson(root, path, all)
    })
  }
  if (key === 'scope/tags.json') {
    const tags = mapped as { tags: Record<string, Json>[]; assignments: Record<string, Json>; regions: Record<string, Json> }
    const all = await readJson<typeof tags & { version?: number }>(root, 'manifests/tags.json', { tags: [], assignments: {}, regions: {} })
    const incoming = new Map(tags.tags.map(t => [t.id, t]))
    all.tags = [...all.tags.filter(t => !incoming.has(t.id)), ...tags.tags]
    Object.assign(all.assignments, tags.assignments); Object.assign(all.regions, tags.regions)
    await writeJson(root, 'manifests/tags.json', all); return
  }
  const path = mapBindingText(key, b, true)
  // Resource paths are restricted, even when a participant sends a forged manifest.
  if (!/^(?:teoria|practica|audio|sintesis|manifests\/(?:materials|entries|synthesis|sintesis|pdf-explanations|subject-voice|inscreen)|subject-voice|progreso\/pizarras)\//.test(path)) throw new Error('Recurso fuera de la esfera.')
  const parts = key.split('/'), aliases = new Set([b.sourceId, b.sourceKey, encodeURIComponent(b.sourceId), encodeURIComponent(b.sourceKey)])
  const scoped = parts.some(part => aliases.has(part))
  const derived = key.startsWith('progreso/pizarras/') || key.startsWith('sintesis/images/') || (key.startsWith('manifests/pdf-explanations/') && (b.owner || !!b.pathAliases?.[parts[2]])) || /^manifests\/subject-voice\/pdf\//.test(key)
  if (!scoped && !derived) throw new Error('El recurso no pertenece a esta esfera.')
  if (mapped instanceof Blob) { await writeFile(root, path, mapped); return }
  const previous = await readJson<Record<string, Json> | null>(root, path, null)
  if (mapped && typeof mapped === 'object' && !Array.isArray(mapped)) {
    if (path.startsWith('progreso/pizarras/')) {
      const content = mapped.content as Record<string, Json>
      if (content) content.camera = previous?.content && typeof previous.content === 'object' && !Array.isArray(previous.content) ? previous.content.camera || { x: 0, y: 0, zoom: 1 } : { x: 0, y: 0, zoom: 1 }
      if (mapped.assets && typeof mapped.assets === 'object' && !Array.isArray(mapped.assets)) {
        for (const [id, ref] of Object.entries(mapped.assets)) if (typeof ref === 'string' && /^cooperation-asset:[a-f0-9]{64}$/.test(ref)) {
          const asset = await readFile(root, `.cooperation/assets/${b.id}/${ref.slice('cooperation-asset:'.length)}`)
          if (!asset) throw new Error('Falta una imagen de la pizarra cooperativa. Reintentá la descarga.')
          const bytes = new Uint8Array(await asset.arrayBuffer()); let text = ''
          for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.slice(offset, offset + 8192))
          mapped.assets[id] = `data:${asset.type || 'application/octet-stream'};base64,${btoa(text)}`
        }
      }
    }
    if (path.startsWith('manifests/sintesis/') && 'workspace' in mapped) mapped.r2 = previous?.r2 || { etag: null, baseline: null }
  }
  await writeJson(root, path, mapped)
}

export async function isFileReferenced(root: FileSystemDirectoryHandle, path: string) {
  for (const name of [...await walk(root, 'manifests'), ...await walk(root, 'progreso/pizarras')]) {
    if (!name.endsWith('.json')) continue
    const file = await readFile(root, name)
    if (file && (await file.text()).includes(path)) return true
  }
  return false
}
