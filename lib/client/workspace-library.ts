'use client'
import { getReadyInscreenConfigToken, getReadyWorkspaceHandle, loadServicesFile, loadWorkspaceHandle, queryWorkspacePermission, setReadyInscreenConfigToken } from '@/lib/local-workspace-client'
import { isLibraryPath, LIBRARY_ROOTS, LIBRARY_STATE_PATH, type LibraryManifest, type LibraryFile, type LibraryItem } from '@/lib/workspace-library'
import { SUBJECTS } from '@/lib/subjects'
import { Sha256 } from '@aws-crypto/sha256-js'
import { HOME_SUBJECT_WEEKDAY } from '@/lib/home-schedule'

type State = { version: 1; workspaceId: string; enabled: boolean; name: string; hashes: Record<string, { modified: number; size: number; hash: string }>; publishedAt?: string }
type Candidate = { path: string; blob: Blob; modified: number }
let running: Promise<LibraryManifest> | null = null
let rerun = false
export type PublicationProgress = { message: string; done: number; total: number; error?: string }
const report = (progress: PublicationProgress) => window.dispatchEvent(new CustomEvent('cursado-library-progress', { detail: progress }))
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
  output.push(...await readPrivateBoards())
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
async function readPrivateBoards(): Promise<Candidate[]> {
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
    for (const board of boards.filter(b => b.id.startsWith('local:'))) {
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
      results.push({ path: `boards/${id}.json`, blob: new Blob([JSON.stringify({ id: board.id, name: board.name, folderId: board.folder_id, scene, assets })], { type: 'application/vnd.cursado.board+json' }), modified: 0 })
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
  for (const [path, data] of textByPath) {
    const payload = data as Record<string, unknown>
    if (path.startsWith('manifests/materials/')) for (const m of (payload.materials || []) as Record<string, unknown>[]) {
      const file = resolveFile(String(m.drive_file_id || ''))
      if (file) referenced.add(file.id)
      if (m.drive_file_id) explanationContexts.set(await hash(new Blob([String(m.drive_file_id)])), { subjectId: String(m.subject_id), week: Number(m.week_number) })
      items.push({ id: `material:${m.id}`, title: String(m.file_name || 'Material'), kind: file?.mime === 'application/pdf' ? 'pdf' : 'file', subjectId: String(m.subject_id), week: Number(m.week_number), section: m.material_type === 'practice' ? 'Práctica' : 'Teoría', ...(file ? { fileId: file.id } : { text: 'El archivo original no está guardado en esta carpeta.' }) })
    }
    if (path.startsWith('manifests/entries/')) for (const e of (payload.entries || []) as Record<string, unknown>[]) {
      const file = resolveFile(String(e.drive_file_id || '')); if (file) referenced.add(file.id)
      items.push({ id: `entry:${e.id}`, title: String(e.custom_title || e.drive_file_name || 'Apunte'), kind: file?.mime.startsWith('audio/') ? 'audio' : 'text', subjectId: String(e.subject_id), week: Number(e.week_number), section: 'Apuntes', text: [e.transcript_text, e.answer_text].filter(Boolean).join('\n\n'), important: e.is_featured === true, ...(file ? { fileId: file.id } : {}) })
    }
    if (path.startsWith('boards/') && path.endsWith('.json')) {
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
    report({ message: 'Buscando cambios guardados…', done: 0, total: 0 })
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
      report({ message: 'Biblioteca actualizada', done: files.length, total: files.length }); return current
    }
    await libraryOwnerApi('cors', { workspaceId })
    let done = 0
    for (let i = 0; i < files.length; i++) {
      const f = files[i], candidate = candidates[i]
      report({ message: `Subiendo ${f.path}`, done, total: files.length })
      if (!current?.files.some(old => old.hash === f.hash && old.size === f.size)) {
        const session = await libraryOwnerApi('upload', { workspaceId, hash: f.hash, size: f.size, mime: f.mime })
        if (session.uploadUrl) {
          const uploaded = await fetch(session.uploadUrl, { method: 'PUT', headers: session.headers, body: candidate.blob })
          if (!uploaded.ok) throw new Error(`Falló la subida de ${f.path} (${uploaded.status}).`)
        } else if (session.session) {
          const parts = []
          try {
            for (let part = 1; part <= session.partCount; part++) {
              const signed = await libraryOwnerApi('upload/part', { workspaceId, session: session.session, part })
              const result = await fetch(signed.url, { method: 'PUT', body: candidate.blob.slice((part - 1) * session.partSize, part * session.partSize) })
              const etag = result.headers.get('ETag')
              if (!result.ok || !etag) throw new Error(`Falló una parte de ${f.path}. Comprobá CORS y la conexión.`)
              parts.push({ ETag: etag, PartNumber: part })
            }
            await libraryOwnerApi('upload/complete', { workspaceId, session: session.session, parts })
          } catch (error) { await libraryOwnerApi('upload/abort', { workspaceId, session: session.session }).catch(() => {}); throw error }
        }
      }
      done++
    }
    const inventory: LibraryManifest = { version: 1, workspaceId, revision: crypto.randomUUID(), publishedAt: new Date().toISOString(), name: state.name, files, ...index }
    await libraryOwnerApi('publish', { workspaceId, previousRevision: current?.revision || null, manifest: inventory })
    await writeState(root, { ...state, hashes: newHashes, publishedAt: inventory.publishedAt })
    report({ message: 'Biblioteca actualizada', done, total: files.length }); return inventory
  }
  running = (navigator.locks ? navigator.locks.request('cursado-library-publication', task) : task()).catch(error => { report({ message: 'Publicación pendiente', done: 0, total: 0, error: error instanceof Error ? error.message : String(error) }); throw error }).finally(() => { running = null; if (rerun) { rerun = false; setTimeout(() => { void publishLibrary(root).catch(() => {}) }, 2000) } })
  return running
}
