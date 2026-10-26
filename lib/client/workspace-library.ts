'use client'
import { getReadyInscreenConfigToken, getReadyWorkspaceHandle, loadServicesFile, loadWorkspaceHandle, queryWorkspacePermission, setReadyInscreenConfigToken } from '@/lib/local-workspace-client'
import { isLibraryPath, LIBRARY_ROOTS, LIBRARY_STATE_PATH, type LibraryManifest, type LibraryFile, type LibraryItem } from '@/lib/workspace-library'
import { SUBJECTS } from '@/lib/subjects'
import { Sha256 } from '@aws-crypto/sha256-js'
import { HOME_SUBJECT_WEEKDAY } from '@/lib/home-schedule'
import { recoverLegacyLibrary } from './workspace-library-legacy'

type State = { version: 1; workspaceId: string; enabled: boolean; name: string; hashes: Record<string, { modified: number; size: number; hash: string }>; publishedAt?: string }
type Candidate = { path: string; blob: Blob; modified: number }
let running: Promise<LibraryManifest> | null = null
let rerun = false
export type PublicationProgress = { message: string; done: number; total: number; phase?: 'preparing' | 'recovering' | 'uploading' | 'verifying' | 'complete' | 'error'; bytesDone?: number; bytesTotal?: number; workspaceId?: string; publishedAt?: string; error?: string; help?: 'cors' }
let latestProgress: PublicationProgress | null = null
export const getLibraryPublicationProgress = () => latestProgress
const report = (progress: PublicationProgress) => { latestProgress = progress; window.dispatchEvent(new CustomEvent('cursado-library-progress', { detail: progress })) }
class LibraryUploadError extends Error { constructor(message: string, public readonly help?: 'cors') { super(message) } }
async function uploadToR2(url: string, options: RequestInit, workspaceId: string, onProgress: (bytes: number) => void) {
  let response: Response | undefined
  try {
    if (typeof XMLHttpRequest === 'undefined') response = await fetch(url, options)
    else response = await new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      Object.entries(options.headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value))
      xhr.upload.onprogress = event => onProgress(event.loaded)
      xhr.onerror = () => reject(new TypeError('No se pudo transferir a R2.'))
      xhr.onabort = () => reject(new Error('Transferencia interrumpida.'))
      xhr.onload = () => resolve(new Response(null, { status: xhr.status, headers: xhr.getResponseHeader('ETag') ? { ETag: xhr.getResponseHeader('ETag')! } : {} }))
      xhr.send(options.body as Blob)
    })
  } catch { /* Browsers hide R2 error bodies when CORS is absent. */ }
  if (response && ![401, 403].includes(response.status)) return response
  if (navigator.onLine === false) throw new Error('Se perdió la conexión. Volvé a conectarte y reintentá la publicación.')
  const diagnosis = await libraryOwnerApi('upload/diagnose', { workspaceId }).catch(() => null)
  throw new LibraryUploadError(`${diagnosis?.message || 'R2 no aceptó la transferencia o el navegador no pudo leer su respuesta. Revisá la conexión, la firma y los permisos del bucket. Un 403 también puede ser un rechazo de la firma o de la clave, aunque la consola mencione CORS.'} La publicación anterior se conserva.`, diagnosis?.problem === 'cors' ? 'cors' : undefined)
}
export async function libraryRoot() {
  const root = getReadyWorkspaceHandle() || await loadWorkspaceHandle()
  if (!root || await queryWorkspacePermission(root, 'readwrite') !== 'granted') throw new Error('Seleccioná o autorizá tu carpeta de Cursado para publicar.')
  const services = await loadServicesFile(root)
  if (services?.inscreenToken) setReadyInscreenConfigToken(services.inscreenToken)
  return root
}
async function fileHandle(root: FileSystemDirectoryHandle, path: string, create = false) {
  const segments = path.split('/'); let dir = root
  for (const segment of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create })
  return dir.getFileHandle(segments.at(-1)!, { create })
}
export async function readLibraryState(root: FileSystemDirectoryHandle): Promise<State | null> {
  try { const value = JSON.parse(await (await (await fileHandle(root, LIBRARY_STATE_PATH)).getFile()).text()) as State
    if (value.version !== 1 || !value.workspaceId) throw new Error('Configuración de biblioteca inválida.')
    return value
  } catch (error) { if ((error as DOMException).name === 'NotFoundError') return null; throw error }
}
async function writeState(root: FileSystemDirectoryHandle, state: State) {
  const writer = await (await fileHandle(root, LIBRARY_STATE_PATH, true)).createWritable()
  try { await writer.write(JSON.stringify(state)); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
}
export async function libraryOwnerApi(action: string, body: Record<string, unknown>, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-inscreen-config-token': getReadyInscreenConfigToken() }
  const response = await fetch(`/api/inscreen/workspace/${action}${method === 'GET' ? `?${new URLSearchParams(body as Record<string, string>)}` : ''}`, { method, headers, cache: 'no-store', ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'No se pudo conectar con R2.')
  return value
}
async function hash(blob: Blob) {
  if (blob.size < 8 * 1024 ** 2) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('')
  const digest = new Sha256(), reader = blob.stream().getReader()
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; digest.update(chunk.value) } }
  finally { reader.releaseLock() }
  return [...await digest.digest()].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function scanLibraryFiles(root: FileSystemDirectoryHandle): Promise<Candidate[]> {
  const output: Candidate[] = []
  async function visit(dir: FileSystemDirectoryHandle, path: string) {
    for await (const [name, handle] of dir.entries()) {
      const current = `${path}/${name}`
      if (handle.kind === 'directory') {
        if (!/^(?:copias|migracion-navegador|migration|provider|pairings|devices)$/i.test(name)) await visit(handle as FileSystemDirectoryHandle, current)
      } else if (isLibraryPath(current)) { const file = await (handle as FileSystemFileHandle).getFile(); output.push({ path: current, blob: file, modified: file.lastModified }) }
    }
  }
  for (const name of LIBRARY_ROOTS) {
    let dir: FileSystemDirectoryHandle
    try { dir = await root.getDirectoryHandle(name) } catch (error) { if ((error as DOMException).name === 'NotFoundError') continue; throw error }
    await visit(dir, name)
  }
  output.push(...await readPrivateBoards(output))
  for (const candidate of [...output]) if (candidate.path.endsWith('/explanations.json')) {
    const explanation = JSON.parse(await candidate.blob.text()) as { entries?: { id: string; html?: string }[] }
    for (const entry of explanation.entries || []) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) || !entry.html) continue
      const path = candidate.path.replace(/explanations\.json$/, `${entry.id}.html`)
      if (!output.some(file => file.path === path)) output.push({ path, blob: new Blob([entry.html], { type: 'text/html' }), modified: 0 })
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path))
}
// Open an existing board database only; publishing never creates or migrates it.
async function readPrivateBoards(existing: Candidate[]): Promise<Candidate[]> {
  if (indexedDB.databases && !(await indexedDB.databases()).some(db => db.name === 'pizarra-dispositivo')) return []
  const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open('pizarra-dispositivo')
    request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => request.error?.name === 'AbortError' ? resolve(null) : reject(request.error)
  })
  if (!db) return []
  try {
    const readAll = <T,>(store: string) => new Promise<T[]>((resolve, reject) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
    const boards = await readAll<{ id: string; name: string; storage: string; updated_at: string; content: Record<string, unknown>; draft?: Record<string, unknown>; folder_id?: string }>('boards')
    const results: Candidate[] = [], usedAssets = new Set<string>()
    const folders = await readAll<{id: string; name: string}>('folders')
    const savedIndex = existing.find(file => file.path === 'boards/library.json')
    const saved = savedIndex ? JSON.parse(await savedIndex.blob.text()) as { folders: {id:string;name:string}[]; boards: {id:string;name:string;folderId:string|null;path:string}[]; deleted?: string[]; deletedFolders?: string[] } : undefined
    const boardIndex: {id: string; name: string; folderId: string | null; path: string}[] = [...saved?.boards ?? []]
    const migrated = new Set([...boardIndex.map(board => board.id), ...saved?.deleted ?? []])
    for (const board of boards.filter(b => b.id.startsWith('local:') && !migrated.has(b.id))) {
      const moved = await new Promise<unknown>((resolve, reject) => { const q = db.transaction('meta').objectStore('meta').get(`workspace-board:${board.id}`); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
      if (moved) continue
      const scene = board.draft || board.content
      const media = (scene.media || []) as { assetId: string }[]
      const assets: Record<string, string> = {}
      for (const item of media) {
        const assetName = await hash(new Blob([item.assetId])); assets[item.assetId] = `boards/${assetName}.bin`
        if (!usedAssets.has(item.assetId)) {
          const blob = await new Promise<Blob | undefined>((resolve, reject) => { const q = db.transaction('assets').objectStore('assets').get(`device:${item.assetId}`); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
          if (!blob) throw new Error(`Falta una imagen de la pizarra «${board.name}». Abrila y volvé a publicar.`)
          results.push({ path: assets[item.assetId], blob, modified: 0 }); usedAssets.add(item.assetId)
        }
      }
      const id = await hash(new Blob([board.id]))
      boardIndex.push({ id: board.id, name: board.name, folderId: board.folder_id || null, path: `boards/${id}.json` })
      results.push({ path: `boards/${id}.json`, blob: new Blob([JSON.stringify({ id: board.id, name: board.name, folderId: board.folder_id, scene, assets })], { type: 'application/vnd.cursado.board+json' }), modified: 0 })
    }
    if (results.length || !savedIndex) {
      if(savedIndex)existing.splice(existing.indexOf(savedIndex),1)
      results.push({ path: 'boards/library.json', blob: new Blob([JSON.stringify({ version: 1, folders: [...saved?.folders ?? [], ...folders.filter(folder=>!saved?.deletedFolders?.includes(folder.id)&&!saved?.folders.some(other=>other.id===folder.id))], boards: boardIndex })], {type:'application/json'}), modified:0 })
    }
    return results
  } finally { db.close() }
}
function mime(path: string, blob: Blob) {
  if (blob.type) return blob.type
  const ext = path.split('.').at(-1)?.toLowerCase() || ''
  return ({ json: 'application/json', pdf: 'application/pdf', html: 'text/html', txt: 'text/plain', md: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg' } as Record<string, string>)[ext] || 'application/octet-stream'
}
async function catalog(candidates: Candidate[], files: LibraryFile[]) {
  const byPath = new Map(files.map(f => [f.path, f])), items: LibraryItem[] = [], referenced = new Set<string>()
  const subjects = new Map<string, LibraryManifest['subjects'][number]>(SUBJECTS.map(s => [s.id, { id: s.id, name: s.name, color: s.color, weekday: HOME_SUBJECT_WEEKDAY[s.id] }]))
  const textByPath = new Map<string, unknown>()
  for (const candidate of candidates) if (candidate.path.endsWith('.json')) {
    try { textByPath.set(candidate.path, JSON.parse(await candidate.blob.text())) } catch { throw new Error(`No se pudo leer ${candidate.path}. Corregí ese archivo antes de publicar.`) }
  }
  const workspace = textByPath.get('manifests/workspace-state.json') as { customSubjects?: Record<string, { id: string; name: string; color: string; targetWeekday?: number }>; subjectWeekdays?: Record<string, number> } | undefined
  for (const s of Object.values(workspace?.customSubjects || {})) subjects.set(s.id, { id: s.id, name: s.name, color: s.color, weekday: s.targetWeekday })
  for (const [id, weekday] of Object.entries(workspace?.subjectWeekdays || {})) { const subject = subjects.get(id); if (subject && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) subject.weekday = weekday }
  const subjectCatalog = textByPath.get('manifests/subject-catalog.json') as { subjects?: Record<string, { id: string; name: string }> } | undefined
  for (const s of Object.values(subjectCatalog?.subjects || {})) if (!subjects.has(s.id)) subjects.set(s.id, { id: s.id, name: s.name, color: '#f59e0b' })
  const resolveFile = (value: string) => byPath.get(String(value || '').replace(/^workspace:\/\//, '').replace(/^workspace:/, ''))
  const explanationContexts = new Map<string, { subjectId: string; week: number }>()
  const ordered = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.session_date || '').localeCompare(String(b.session_date || '')) || (Number(a.order_index) || 0) - (Number(b.order_index) || 0))
  for (const [path, data] of textByPath) {
    const payload = data as Record<string, unknown>
    if (path.startsWith('manifests/materials/')) for (const m of ordered((payload.materials || []) as Record<string, unknown>[])) {
      if (!subjects.has(String(m.subject_id))) subjects.set(String(m.subject_id), { id: String(m.subject_id), name: String(m.subject_name || m.subject_id), color: '#f59e0b' })
      const file = resolveFile(String(m.drive_file_id || ''))
      if (file) referenced.add(file.id)
      if (m.drive_file_id) explanationContexts.set(await hash(new Blob([String(m.drive_file_id)])), { subjectId: String(m.subject_id), week: Number(m.week_number) })
      items.push({ id: `material:${m.id}`, title: String(m.file_name || 'Material'), kind: file?.mime === 'application/pdf' ? 'pdf' : 'file', subjectId: String(m.subject_id), week: Number(m.week_number), section: m.material_type === 'practice' ? 'Práctica' : 'Teoría', ...(file ? { fileId: file.id } : { text: 'El archivo original no está guardado en esta carpeta.' }) })
    }
    if (path.startsWith('manifests/entries/')) for (const e of ordered((payload.entries || []) as Record<string, unknown>[])) {
      const file = resolveFile(String(e.drive_file_id || '')); if (file) referenced.add(file.id)
      items.push({ id: `entry:${e.id}`, title: String(e.custom_title || e.drive_file_name || 'Apunte'), kind: file?.mime.startsWith('audio/') ? 'audio' : 'text', subjectId: String(e.subject_id), week: Number(e.week_number), section: 'Apuntes', text: [e.transcript_text, e.answer_text].filter(Boolean).join('\n\n'), important: e.is_featured === true, ...(file ? { fileId: file.id } : {}) })
    }
    if (path.startsWith('boards/') && path.endsWith('.json') && path !== 'boards/library.json') {
      const f = byPath.get(path)!; referenced.add(f.id)
      items.push({ id: String(payload.id), title: String(payload.name || 'Pizarra'), kind: 'board', fileId: f.id })
    }
    const synthesis = /^manifests\/sintesis\/([^/]+)\/semana-(\d+)\/workspace\.json$/.exec(path)
    if (synthesis) { const f = byPath.get(path)!; referenced.add(f.id); items.push({ id: `synthesis:${synthesis[1]}:${synthesis[2]}`, title: 'Síntesis', kind: 'synthesis', subjectId: synthesis[1], week: Number(synthesis[2]), section: 'Síntesis', fileId: f.id }) }
  }
  for (const [path, data] of textByPath) {
    const match = /^manifests\/pdf-explanations\/([^/]+)\/explanations\.json$/.exec(path)
    if (!match) continue
    referenced.add(byPath.get(path)!.id)
    const context = explanationContexts.get(match[1])
    const payload = data as { entries?: { id: string; question?: string; annotation?: { pageIndex?: number } }[] }
    for (const entry of payload.entries || []) {
      const file = byPath.get(path.replace(/explanations\.json$/, `${entry.id}.html`))
      if (!file) continue
      referenced.add(file.id)
      items.push({ id: `explanation:${match[1]}:${entry.id}`, title: `${entry.question || 'Verlo'}${entry.annotation?.pageIndex != null ? ` · Página ${entry.annotation.pageIndex + 1}` : ''}`, kind: 'html', fileId: file.id, section: 'Verlo', ...context })
    }
  }
  for (const file of files) if (!referenced.has(file.id) && !file.path.startsWith('boards/') && (!file.path.startsWith('manifests/') || file.path.startsWith('manifests/pdf-explanations/'))) {
    const s = [...subjects.values()].find(s => file.path.toLowerCase().includes(`/${s.name.toLowerCase()}/`))
    const week = /(?:semana-|week-)(\d+)/.exec(file.path)
    items.push({ id: `file:${file.id}`, title: file.path.split('/').at(-1)!, kind: file.mime === 'application/pdf' ? 'pdf' : 'file', fileId: file.id, subjectId: s?.id, week: week ? Number(week[1]) : undefined, section: file.path.startsWith('manifests/pdf-explanations/') ? 'Verlo' : 'Recursos' })
  }
  return { subjects: [...subjects.values()], items }
}
export function publishLibrary(root: FileSystemDirectoryHandle, options: { enable?: boolean; name?: string } = {}) {
  if (running) { rerun = true; return running }
  const task = async () => {
    const previous = await readLibraryState(root)
    const state: State = previous || { version: 1, workspaceId: crypto.randomUUID(), enabled: true, name: options.name || root.name, hashes: {} }
    state.enabled = options.enable ?? state.enabled; state.name = options.name || state.name
    await writeState(root, state)
    const workspaceId = state.workspaceId
    const emit = (progress: PublicationProgress) => report({ ...progress, workspaceId })
    const previousSources = await recoverLegacyLibrary(root, { workspaceId, api: libraryOwnerApi, headers: () => ({ 'x-inscreen-config-token': getReadyInscreenConfigToken() }), report: (message, bytesDone, bytesTotal) => emit({ phase: 'recovering', message, done: 0, total: 0, bytesDone, bytesTotal }) })
    emit({ phase: 'preparing', message: 'Buscando cambios guardados…', done: 0, total: 0 })
    const current = (await libraryOwnerApi('status', { workspaceId }, 'GET')).manifest as LibraryManifest | null
    const candidates = await scanLibraryFiles(root), files: LibraryFile[] = [], newHashes: State['hashes'] = {}
    for (const c of candidates) {
      const cached = state.hashes[c.path]
      const fingerprint = c.modified > 0 && cached?.modified === c.modified && cached.size === c.blob.size ? cached.hash : await hash(c.blob)
      newHashes[c.path] = { modified: c.modified, size: c.blob.size, hash: fingerprint }
      files.push({ id: await hash(new Blob([c.path])), path: c.path, hash: fingerprint, size: c.blob.size, mime: mime(c.path, c.blob) })
    }
    const index = await catalog(candidates, files)
    if (current && JSON.stringify(current.files) === JSON.stringify(files) && JSON.stringify(current.items) === JSON.stringify(index.items) && JSON.stringify(current.subjects) === JSON.stringify(index.subjects) && current.name === state.name) {
      await writeState(root, { ...state, hashes: newHashes, publishedAt: current.publishedAt })
      return current
    }
    await libraryOwnerApi('cors', { workspaceId })
    const confirmed = new Set((current?.files || []).map(file => `${file.hash}:${file.size}`))
    let done = files.filter(file => confirmed.has(`${file.hash}:${file.size}`)).length
    let bytesDone = files.reduce((total, file) => total + (confirmed.has(`${file.hash}:${file.size}`) ? file.size : 0), 0)
    const bytesTotal = files.reduce((total, file) => total + file.size, 0)
    for (let i = 0; i < files.length; i++) {
      const f = files[i], candidate = candidates[i]
      if (confirmed.has(`${f.hash}:${f.size}`)) continue
      const uploading = (bytes = 0) => emit({ phase: 'uploading', message: `Subiendo ${f.path}`, done, total: files.length, bytesDone: bytesDone + Math.min(bytes, f.size), bytesTotal })
      uploading()
      if (!current?.files.some(old => old.hash === f.hash && old.size === f.size)) {
        const session = await libraryOwnerApi('upload', { workspaceId, hash: f.hash, size: f.size, mime: f.mime, ...(previousSources[f.path] ? { previousKey: previousSources[f.path] } : {}) })
        if (session.uploadUrl) {
          const uploaded = await uploadToR2(session.uploadUrl, { method: 'PUT', headers: session.headers, body: candidate.blob }, workspaceId, uploading)
          if (!uploaded.ok) throw new Error(`Falló la subida de ${f.path} (${uploaded.status}).`)
        } else if (session.session) {
          const parts = []
          try {
            for (let part = 1; part <= session.partCount; part++) {
              const signed = await libraryOwnerApi('upload/part', { workspaceId, session: session.session, part })
              const offset = (part - 1) * session.partSize
              const result = await uploadToR2(signed.url, { method: 'PUT', body: candidate.blob.slice(offset, part * session.partSize) }, workspaceId, bytes => uploading(offset + bytes))
              const etag = result.headers.get('ETag')
              if (!result.ok) throw new Error(`Falló una parte de ${f.path} (${result.status}). Reintentá la publicación.`)
              if (!etag) throw new LibraryUploadError('R2 recibió una parte, pero CORS no permite leer ETag. Abrí «Revisar permisos CORS» y agregá ETag en ExposeHeaders. La publicación anterior se conserva.', 'cors')
              parts.push({ ETag: etag, PartNumber: part })
            }
            await libraryOwnerApi('upload/complete', { workspaceId, session: session.session, parts })
          } catch (error) { await libraryOwnerApi('upload/abort', { workspaceId, session: session.session }).catch(() => {}); throw error }
        }
      }
      done++; bytesDone += f.size
      emit({ phase: 'uploading', message: 'Recursos enviados', done, total: files.length, bytesDone, bytesTotal })
    }
    const inventory: LibraryManifest = { version: 1, workspaceId, revision: crypto.randomUUID(), publishedAt: new Date().toISOString(), name: state.name, files, ...index }
    emit({ phase: 'verifying', message: 'Verificando los archivos y activando la publicación…', done, total: files.length, bytesDone, bytesTotal })
    await libraryOwnerApi('publish', { workspaceId, previousRevision: current?.revision || null, manifest: inventory })
    await writeState(root, { ...state, hashes: newHashes, publishedAt: inventory.publishedAt })
    return inventory
  }
  report({ phase: 'preparing', message: 'Preparando la sincronización…', done: 0, total: 0 })
  const synchronize = async () => {
    let manifest: LibraryManifest
    do { rerun = false; manifest = await task() } while (rerun)
    const bytes = manifest.files.reduce((total, file) => total + file.size, 0)
    report({ phase: 'complete', message: 'Biblioteca sincronizada', workspaceId: manifest.workspaceId, publishedAt: manifest.publishedAt, done: manifest.files.length, total: manifest.files.length, bytesDone: bytes, bytesTotal: bytes })
    return manifest
  }
  running = (navigator.locks ? navigator.locks.request('cursado-library-publication', synchronize) : synchronize()).catch(error => { report({ ...latestProgress, phase: 'error', message: 'Sincronización pendiente', done: latestProgress?.done || 0, total: latestProgress?.total || 0, error: error instanceof Error ? error.message : String(error), ...(error instanceof LibraryUploadError ? { help: error.help } : {}) }); throw error }).finally(() => { running = null })
  return running
}
