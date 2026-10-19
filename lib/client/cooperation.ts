'use client'
import { uploadCooperationFile } from './cooperation-upload.ts'
import { cooperationResourceBytes, cooperationSyncLabel } from '../cooperation-sync-status.ts'
import { projectSelectionTags, selectionResources, type WeekSelection } from './cooperation-selection.ts'
import { COOPERATIVE_TAB_ID, mergeCooperation, type Json } from '../cooperation-model.ts'
import { getReadyInscreenConfigToken, getReadyWorkspaceHandle, loadServicesFile, loadWorkspaceHandle, queryWorkspacePermission } from '../local-workspace-client.ts'
import { applyMirrorFile, digest, isFileReferenced, mapBindingJson, mapBindingText, readFile, readJson, removeFile, scanSphere, writeFile, writeJson, type SphereBinding } from './cooperation-files.ts'

export type CooperativeSphere = { id: string; group_id: string; name: string; color: string; created_by: string; bytes: number; ready?: boolean }
export type CooperativeGroup = { id: string; accepted: boolean; members: { id: string; display_name: string }[]; spheres: CooperativeSphere[] }
export type Resource = { key: string; type: 'json' | 'blob' | 'delete'; value?: Json; blob?: { hash: string; size: number; mime: string }; deleted?: boolean; seq?: number; author?: string }
type Snapshot = { seq: number; resources: Record<string, Resource>; conflicts: Json[] }
type Operation = { id: string; changes: (Resource & { base?: Json; baseHash?: string })[] }
export type PendingDeletion = { id: string; sphereId: string; key: string; selector: string[]; value?: Json; label: string; decision: 'wait' | 'keep' | 'delete'; notified?: boolean }
type Mirror = { selection?: WeekSelection; binding: SphereBinding; baseline: Snapshot; outbox?: Operation; incoming?: Snapshot; incomingApplied?: string[]; downloading?: boolean; metadataReady?: boolean; transfer?: { phase: 'uploading' | 'downloading'; completed: number; total: number }; error?: string }
export type CooperationState = { version: 1; userId: string; groups: CooperativeGroup[]; mirrors: Record<string, Mirror>; deletions: PendingDeletion[]; dismissedSpheres?: string[]; error?: string }
let state: CooperationState = { version: 1, userId: '', groups: [], mirrors: {}, deletions: [] }
let activeRoot: FileSystemDirectoryHandle | null = null
const sockets = new Map<string, WebSocket>()
const presences = new Map<string, { users: { id: string; name: string; color: string; emoji: string; client_ids: string[] }[]; you: string }>()
export const cooperationState = () => state
const confirmedMirrors = new Set<string>()
let syncRevision = 0
function invalidateSyncStatus() { syncRevision++; confirmedMirrors.clear(); cooperationChanged() }
export function cooperationSubjectSyncLabel(subjectId: string) {
  return cooperationSyncLabel(subjectId, Object.values(state.mirrors), confirmedMirrors, navigator.onLine !== false && !state.error)
}
export async function cooperationSubjectSyncDetails(subjectId: string) {
  const mirror = Object.values(state.mirrors).find(mirror => mirror.binding.subjectId === subjectId)
  if (!mirror) return null
  const resources = { ...mirror.baseline.resources, ...mirror.incoming?.resources, ...Object.fromEntries((mirror.outbox?.changes || []).map(change => [change.key, { ...change, deleted: change.type === 'delete' }])) }
  const allowed = mirror.selection ? (await selectionResources(resources, mirror.selection.excludedWeeks)).allowed : undefined
  return { name: mirror.binding.name, bytes: cooperationResourceBytes(resources, allowed) }
}
export { COOPERATIVE_TAB_ID }
export const cooperationGroupTab = (id: string) => `cooperative-${id}`
export function cooperationChanged() { window.dispatchEvent(new CustomEvent('cursado-cooperation-changed', { detail: state })) }
export async function cooperationApi(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`/pizarra/api/cooperation/${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.detail || result.error || 'No se pudo conectar con Cooperativo.')
  return result
}
async function root() {
  const handle = getReadyWorkspaceHandle() || await loadWorkspaceHandle()
  if (!handle || await queryWorkspacePermission(handle, 'readwrite') !== 'granted') throw new Error('Abrí Estudio y autorizá tu carpeta local para cooperar.')
  return handle
}
let saveQueue: Promise<unknown> = Promise.resolve()
async function save() {
  const handle = activeRoot, userId = state.userId, snapshot = structuredClone(state)
  if (handle && userId) {
    const write = () => writeJson(handle, `.cooperation/${userId}/state.json`, snapshot)
    saveQueue = saveQueue.then(write, write)
    await saveQueue
  }
  cooperationChanged()
}
async function withStateLock<T>(work: () => Promise<T>): Promise<T> {
  const run = async () => {
    if (activeRoot && state.userId) state = await readJson(activeRoot, `.cooperation/${state.userId}/state.json`, state)
    return work()
  }
  return navigator.locks ? navigator.locks.request(`cooperation:${state.userId}`, run) : run()
}
export async function refreshCooperation() {
  const result = await cooperationApi('groups') as { user: { id: string }; groups: CooperativeGroup[] }
  const handle = await root()
  if (syncing && state.userId === result.user.id && activeRoot === handle) {
    // Discovery must stay responsive while a PDF is transferring. The active
    // synchronization persists this directory update with its next checkpoint.
    state.groups = result.groups; delete state.error; cooperationChanged(); return state
  }
  if (syncing) await syncing
  if (state.userId !== result.user.id || activeRoot !== handle) {
    confirmedMirrors.clear()
    for (const socket of sockets.values()) socket.close()
    sockets.clear()
    activeRoot = handle
    state = await readJson(handle, `.cooperation/${result.user.id}/state.json`, { version: 1, userId: result.user.id, groups: [], mirrors: {}, deletions: [] } as CooperationState)
    localStorage.setItem('cursado-cooperation-user', result.user.id)
  }
  await withStateLock(async () => { state.groups = result.groups; delete state.error; await save() })
  return state
}
export async function restoreCooperationOffline() {
  const userId = localStorage.getItem('cursado-cooperation-user')
  if (!userId) return
  activeRoot = await root()
  state = await readJson(activeRoot, `.cooperation/${userId}/state.json`, state)
  cooperationChanged()
}
export async function createCooperationGroup(names: string) {
  const result = await cooperationApi('groups', { names })
  await refreshCooperation()
  return result.id as string
}
async function installSubject(b: SphereBinding) {
  const handle = await root(), timestamp = new Date().toISOString()
  const catalog = await readJson<{ version: number; subjects: Record<string, Record<string, unknown>> }>(handle, 'manifests/subject-catalog.json', { version: 2, subjects: {} })
  const current = catalog.subjects[b.subjectId]
  if (!current || current.name !== b.name || current.cooperationId !== b.id) {
    catalog.subjects[b.subjectId] = { ...current, id: b.subjectId, cooperationId: b.id, name: b.name, storageKey: b.storageKey, normalizedName: b.name.toLowerCase(), createdAt: current?.createdAt || timestamp, updatedAt: timestamp }
    await writeJson(handle, 'manifests/subject-catalog.json', catalog)
  }
  const workspace = await readJson<Record<string, Json>>(handle, 'manifests/workspace-state.json', { workspaceTabs: {}, customSubjects: {}, subjectWeekdays: {}, activeWorkspaceTabId: 'main', isMainWorkspaceTabVisible: true })
  const before = JSON.stringify(workspace), tabs = workspace.workspaceTabs as Record<string, Record<string, Json>>, subjects = workspace.customSubjects as Record<string, Record<string, Json>>
  const tabId = cooperationGroupTab(b.groupId), group = state.groups.find(g => g.id === b.groupId)
  tabs[tabId] ||= { id: tabId, name: group?.members.map(m => m.display_name).join(', ') || 'Cooperativo', color: '#16a34a', createdAt: timestamp, subjectIds: [] }
  tabs[tabId].subjectIds = [...new Set([...(tabs[tabId].subjectIds as string[]), b.subjectId])]
  subjects[b.subjectId] = { id: b.subjectId, tabId: b.owner ? 'main' : tabId, createdAt: timestamp, targetWeekday: 0, ...subjects[b.subjectId], storageKey: b.storageKey, name: b.name, color: b.color }
  if (JSON.stringify(workspace) !== before) await writeJson(handle, 'manifests/workspace-state.json', workspace)
  window.dispatchEvent(new CustomEvent('cursado-cooperation-subject', { detail: b }))
}
export async function shareCooperationSphere(groupId: string, subject: { id: string; name: string; color: string; storageKey?: string }, options: { background?: boolean } = {}) {
  await refreshCooperation()
  const binding = await withStateLock(async () => {
  const already = Object.values(state.mirrors).find(m => m.binding.groupId === groupId && m.binding.subjectId === subject.id)
  if (already) return already.binding
  const sharedElsewhere = Object.values(state.mirrors).find(m => m.binding.subjectId === subject.id)
  if (sharedElsewhere) throw new Error('Esta esfera ya coopera con otro grupo. Usá ese grupo para mantener un único espejo.')
  const result = await cooperationApi('spheres', { groupId, name: subject.name, color: subject.color })
  const catalog = await readJson<{ subjects: Record<string, { storageKey: string }> }>(await root(), 'manifests/subject-catalog.json', { subjects: {} })
  const key = subject.storageKey || catalog.subjects[subject.id]?.storageKey || subject.id
  const binding: SphereBinding = { id: result.id, groupId, subjectId: subject.id, storageKey: key, sourceId: subject.id, sourceKey: key, name: subject.name, color: subject.color, owner: true }
  state.mirrors[result.id] = { binding, baseline: { seq: 0, resources: {}, conflicts: [] } }
  await installSubject(binding)
  await save()
  return binding
  })
  await publishSphereMetadata(state.mirrors[binding.id])
  await refreshCooperation()
  if (options.background) { synchronizeInBackground(); return binding }
  await synchronizeCooperation()
  if (state.mirrors[binding.id]?.error) throw new Error(state.mirrors[binding.id].error)
  await refreshCooperation()
  return binding
}
export async function acceptCooperationSphere(sphere: CooperativeSphere, options: { background?: boolean; choose?: boolean } = {}) {
  const handle = await root()
  await cooperationApi(`spheres/${sphere.id}/accept`, {})
  const snapshot = await cooperationApi(`spheres/${sphere.id}/snapshot`) as Snapshot
  const meta = snapshot.resources['sphere.json']?.value as Record<string, Json> | undefined
  if (!meta) throw new Error('La esfera todavía se está preparando. Reintentá en unos instantes.')
  await withStateLock(async () => {
  if (!state.mirrors[sphere.id]) {
    const subjectId = `coop-${sphere.id}`, storageKey = `Cooperativo-${sphere.id}`
    const catalog = await readJson<{ subjects: Record<string, { storageKey: string }> }>(handle, 'manifests/subject-catalog.json', { subjects: {} })
    if (catalog.subjects[subjectId] || Object.values(catalog.subjects).some(s => s.storageKey === storageKey)) throw new Error('Ya existe una materia con el identificador de esta esfera. No se sobrescribió.')
    state.mirrors[sphere.id] = { binding: { id: sphere.id, groupId: sphere.group_id, subjectId, storageKey, sourceId: String(meta.subjectId), sourceKey: String(meta.storageKey), name: sphere.name, color: sphere.color, owner: false }, baseline: { seq: 0, resources: {}, conflicts: [] }, downloading: true, ...(options.choose ? { selection: { choosing: true, excludedWeeks: [], weeks: [] } } : {}) }
    await save()
  }
  })
  if (options.choose) {
    await synchronizeCooperation()
    const mirror = state.mirrors[sphere.id]
    if (mirror.error) throw new Error(mirror.error)
    window.dispatchEvent(new CustomEvent('cursado-cooperation-select', { detail: mirror.binding }))
    return
  }
  if (options.background) { synchronizeInBackground(); return }
  await synchronizeCooperation()
  if (state.mirrors[sphere.id]?.error) throw new Error(state.mirrors[sphere.id].error)
  await installSubject(state.mirrors[sphere.id].binding)
  await refreshCooperation()
}
export async function toggleCooperationWeek(sphereId: string, week: number) {
  if (syncing) await syncing
  await withStateLock(async () => {
    const selection = state.mirrors[sphereId]?.selection
    if (!selection?.choosing || !selection.weeks.includes(week)) return
    selection.excludedWeeks = selection.excludedWeeks.includes(week) ? selection.excludedWeeks.filter(w => w !== week) : [...selection.excludedWeeks, week]
    await save()
  })
}
export async function finishCooperationSelection(sphereId: string) {
  if (syncing) await syncing
  await withStateLock(async () => {
    const mirror = state.mirrors[sphereId]
    if (!mirror?.selection?.choosing) return
    const handle = await root(), snapshot = mirror.incoming || mirror.baseline
    const { allowed } = await selectionResources(snapshot.resources, mirror.selection.excludedWeeks)
    // Preview metadata is local only. Removing it must never become a remote deletion.
    for (const [key, resource] of Object.entries(snapshot.resources)) {
      if (!allowed.has(key) && resource.type === 'json' && !key.startsWith('scope/') && key !== 'sphere.json') await removeFile(handle, mapBindingText(key, mirror.binding, true))
    }
    mirror.selection.choosing = false
    mirror.baseline = snapshot; delete mirror.incoming; delete mirror.incomingApplied
    mirror.downloading = true
    await save()
    window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: mirror.binding }))
  })
  synchronizeInBackground()
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const record = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v)
const metadataKinds = new WeakMap<Resource, boolean>()
function metadataResource(resource: Resource) {
  let result = metadataKinds.get(resource)
  if (result === undefined) {
    result = resource.type === 'json' && !resource.key.startsWith('progreso/pizarras/') && JSON.stringify(resource.value ?? null).length <= 256 * 1024
    metadataKinds.set(resource, result)
  }
  return result
}
async function publishSphereMetadata(mirror: Mirror) {
  if (!mirror.binding.owner || mirror.baseline.resources['sphere.json']) return
  const b = mirror.binding
  await cooperationApi(`spheres/${b.id}/operations`, { id: `metadata-${b.id}`, changes: [{ key: 'sphere.json', type: 'json', value: { subjectId: b.sourceId, storageKey: b.sourceKey, name: b.name, color: b.color } }] })
}
async function prepareBinding(b: SphereBinding, resources: Record<string, Resource>) {
  if (b.owner) return
  const numbers = new Set<number>()
  const collect = (value: Json, field = '') => {
    if (typeof value === 'number' && /^(?:id|.*_id|.*Id)$/.test(field)) numbers.add(value)
    if (Array.isArray(value)) value.forEach(v => collect(v, field))
    else if (record(value)) Object.entries(value).forEach(([key, v]) => collect(v, key))
  }
  for (const resource of Object.values(resources)) if (resource.value !== undefined) collect(resource.value)
  for (const id of numbers) if (!b.numberAliases?.[id]) {
    const hash = await digest(new Blob([`${b.id}:${id}`]))
    b.numberAliases = { ...b.numberAliases, [id]: parseInt(hash.slice(0, 12), 16) }
  }
  for (const key of Object.keys(resources)) {
    if (key.startsWith('progreso/pizarras/')) {
      const filename = key.split('/').at(-1)!, id = filename.replace(/\.json$/, ''), local = `${id}-${b.id.slice(0, 8)}`
      b.pathAliases = { ...b.pathAliases, [id]: local, [filename]: `${local}.json` }
    }
    if (key.startsWith('sintesis/images/')) {
      const filename = key.split('/').at(-1)!, id = filename.replace(/\.[^.]+$/, ''), local = `${id}-${b.id.slice(0, 8)}`
      b.pathAliases = { ...b.pathAliases, [filename]: filename.replace(id, local), [`synthesis-local-image:${id}`]: `synthesis-local-image:${local}` }
    }
    if (/^(?:teoria|practica)\/.+\.pdf$/i.test(key)) {
      const canonical = `workspace://${key}`, local = mapBindingText(canonical, b, true)
      b.pathAliases = { ...b.pathAliases, [await digest(new Blob([canonical]))]: await digest(new Blob([local])) }
    }
  }
}
function select(value: Json | undefined, selector: string[]): Json | undefined {
  if (!selector.length) return value
  const [key, ...rest] = selector
  if (key.startsWith('@') && Array.isArray(value)) return select(value.find(v => record(v) && String(v.id) === key.slice(1)), rest)
  return record(value) ? select(value[key], rest) : undefined
}
function setSelected(value: Json | undefined, selector: string[], replacement: Json | undefined): Json | undefined {
  if (!selector.length) return replacement
  const [key, ...rest] = selector
  if (key.startsWith('@')) {
    const rows = Array.isArray(value) ? [...value] : [], id = key.slice(1), index = rows.findIndex(v => record(v) && String(v.id) === id)
    const next = setSelected(index < 0 ? undefined : rows[index], rest, replacement)
    if (index < 0 && next !== undefined) rows.push(next)
    else if (next === undefined && index >= 0) rows.splice(index, 1)
    else if (index >= 0 && next !== undefined) rows[index] = next
    return rows
  }
  const result = record(value) ? { ...value } : {}
  const next = setSelected(result[key], rest, replacement)
  if (next === undefined) delete result[key]; else result[key] = next
  return result
}
function protectDeletions(sphereId: string, key: string, base: Json | undefined, remote: Json | undefined, local: Json | undefined, selector: string[] = []) {
  if (base !== undefined && remote === undefined && local !== undefined) {
    if (selector.length && !selector.at(-1)!.startsWith('@')) return
    const id = JSON.stringify([sphereId, key, selector])
    if (!state.deletions.some(d => d.id === id)) {
      const label = record(local) ? String(local.file_name || local.name || local.custom_title || 'Elemento') : key.split('/').at(-1)!
      state.deletions.push({ id, sphereId, key, selector, value: local, label, decision: 'wait' })
    }
    return
  }
  if (Array.isArray(base) && Array.isArray(remote)) {
    for (const item of base) if (record(item) && item.id !== undefined) {
      const id = String(item.id)
      protectDeletions(sphereId, key, item, remote.find(v => record(v) && String(v.id) === id), Array.isArray(local) ? local.find(v => record(v) && String(v.id) === id) : undefined, [...selector, `@${id}`])
    }
  } else if (record(base) && record(remote)) {
    for (const name of Object.keys(base)) protectDeletions(sphereId, key, base[name], remote[name], record(local) ? local[name] : undefined, [...selector, name])
  }
}
function withoutPersonal(sphereId: string, key: string, value: Json | undefined) {
  for (const pending of state.deletions.filter(d => d.sphereId === sphereId && d.key === key)) value = setSelected(value, pending.selector, undefined)
  return value
}
async function synchronizeMirror(mirror: Mirror) {
  const revision = syncRevision
  const handle = await root(), b = mirror.binding
  let moreChanges = false
  if (state.deletions.some(d => d.sphereId === b.id && d.key === 'sphere.json' && d.decision !== 'wait')) return
  if (mirror.selection?.choosing) {
    const snapshot = await cooperationApi(`spheres/${b.id}/snapshot`) as Snapshot
    await prepareBinding(b, snapshot.resources)
    const { weeks } = await selectionResources(snapshot.resources, [])
    const existing = new Set(mirror.selection.weeks)
    // Start gray; genuinely new weeks after finishing remain included automatically.
    mirror.selection.excludedWeeks.push(...weeks.filter(w => !existing.has(w)))
    mirror.selection.weeks = weeks
    for (const [key, resource] of Object.entries(snapshot.resources)) if ((key.startsWith('manifests/materials/') || key.startsWith('manifests/entries/') || key === 'scope/containers.json' || key === 'scope/shortcuts.json') && !resource.deleted && resource.value !== undefined) await applyMirrorFile(handle, b, key, resource.value)
    mirror.incoming = snapshot; mirror.metadataReady = true; delete mirror.error
    await installSubject(b); await save()
    window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: b }))
    return
  }
  await publishSphereMetadata(mirror)
  const wasDownloading = mirror.downloading
  const localCatalog = await readJson<{ subjects: Record<string, { name: string; storageKey: string }> }>(handle, 'manifests/subject-catalog.json', { subjects: {} })
  const catalogSubject = localCatalog.subjects[b.subjectId]
  if (catalogSubject) { b.storageKey = catalogSubject.storageKey; b.name = catalogSubject.name }
  await prepareBinding(b, mirror.baseline.resources)
  // Hash-based PDF metadata must follow the receiving device's local file URI.
  for (const key of Object.keys(mirror.baseline.resources)) if (/^(?:teoria|practica)\/.+\.pdf$/i.test(key)) {
    const canonical = `workspace://${key}`, local = mapBindingText(canonical, b, true)
    if (canonical !== local) {
      const sourceHash = await digest(new Blob([canonical])), localHash = await digest(new Blob([local]))
      b.pathAliases = { ...b.pathAliases, [sourceHash]: localHash }
    }
  }
  let files = mirror.downloading && !mirror.metadataReady ? [] : await scanSphere(handle, b)
  if (!mirror.downloading) {
    const catalog = await readJson<{ subjects: Record<string, unknown> }>(handle, 'manifests/subject-catalog.json', { subjects: {} })
    const workspace = await readJson<{ customSubjects: Record<string, { color: string }> }>(handle, 'manifests/workspace-state.json', { customSubjects: {} })
    if (workspace.customSubjects[b.subjectId]?.color) b.color = workspace.customSubjects[b.subjectId].color
    if (catalog.subjects[b.subjectId]) files.push({ key: 'sphere.json', value: { subjectId: b.sourceId, storageKey: b.sourceKey, name: b.name, color: b.color } })
  }
  const publicationResources = { ...mirror.baseline.resources, ...Object.fromEntries(files.map(file => [file.key, { key: file.key, type: file.blob ? 'blob' : 'json', value: file.value, blob: mirror.baseline.resources[file.key]?.blob }])) }
  const publicationSelection = mirror.selection ? await selectionResources(publicationResources, mirror.selection.excludedWeeks) : null
  const publicationAllowed = publicationSelection?.allowed
  if (publicationAllowed) files = files.filter(file => publicationAllowed.has(file.key))
  const current = new Map(files.map(file => [file.key, file]))
  if (mirror.outbox && !mirror.incoming) {
    for (const change of mirror.outbox.changes) if (change.blob) {
      const latest = current.get(change.key)?.blob
      if (!latest || await digest(latest) !== change.blob.hash) { mirror.outbox = undefined; await save(); break }
    }
  }
  if (!mirror.downloading && !mirror.incoming && !mirror.outbox) {
    const changes: Operation['changes'] = []
    for (const file of files) {
      const prior = mirror.baseline.resources[file.key]
      if (prior?.deleted || state.deletions.some(d => d.sphereId === b.id && d.key === file.key && !d.selector.length)) continue
      if (file.blob) {
        const hash = await digest(file.blob)
        if (hash !== prior?.blob?.hash) changes.push({ key: file.key, type: 'blob', blob: { hash, size: file.blob.size, mime: file.blob.type }, baseHash: prior?.blob?.hash })
      } else {
        let value = withoutPersonal(b.id, file.key, file.value)
        if (mirror.selection && file.key === 'scope/tags.json' && record(value) && record(prior?.value)) {
          const base = prior.value
          const materialIds = publicationSelection!.materialIds
          const untouched = (rows: Json, regions = false) => Object.fromEntries(Object.entries(record(rows) ? rows : {}).filter(([id]) => !materialIds.has(regions ? id.split(':')[0] : id)))
          const mergeRows = (a: Json, b: Json) => [...new Map([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter(record).map(row => [String(row.id), row])).values()]
          value = { ...base, ...value, tags: mergeRows(base.tags, value.tags), assignments: { ...untouched(base.assignments), ...(record(value.assignments) ? value.assignments : {}) }, regions: { ...untouched(base.regions, true), ...(record(value.regions) ? value.regions : {}) } }
        }
        if (value !== undefined && !eq(value, prior?.value)) changes.push({ key: file.key, type: 'json', value, base: prior?.value })
      }
    }
    for (const [key, prior] of Object.entries(mirror.baseline.resources)) if ((!publicationAllowed || publicationAllowed.has(key)) && !prior.deleted && !current.has(key) && !state.deletions.some(d => d.sphereId === b.id && d.key === key)) {
      // An empty week is still a live collection: future PDFs must be able to use it.
      const field = key.startsWith('manifests/materials/') ? 'materials' : key.startsWith('manifests/entries/') ? 'entries' : null
      if (field && record(prior.value)) {
        const value = { ...prior.value, [field]: [] }
        if (!eq(value, prior.value)) changes.push({ key, type: 'json', base: prior.value, value })
      } else changes.push({ key, type: 'delete' })
    }
    if (changes.length) {
      // Publish metadata before starting any large upload. Board JSON follows its assets.
      const metadata = changes.filter(metadataResource)
      const batch = (metadata.length ? metadata : changes.sort((a,b) => Number(a.key.startsWith('progreso/pizarras/')) - Number(b.key.startsWith('progreso/pizarras/')))).slice(0, 200)
      moreChanges = changes.length > batch.length
      mirror.outbox = { id: crypto.randomUUID(), changes: batch }
      await save() // Persist the operation before the first network mutation.
    }
  }
  if (mirror.outbox && !mirror.incoming) {
    const configToken = getReadyInscreenConfigToken() || (await loadServicesFile(handle))?.inscreenToken
    const library = await readJson<{ workspaceId?: string }>(handle, 'manifests/workspace-library-sync.json', {})
    const uploadOptions = { configToken, workspaceId: library.workspaceId }
    mirror.transfer = { phase: 'uploading', completed: 0, total: mirror.outbox.changes.filter(change => change.blob).length }
    await save()
    for (const change of mirror.outbox.changes) if (change.blob) {
      const file = current.get(change.key)?.blob
      // A queued file may have changed while offline. Its exact bytes live in staging.
      const staging = `.cooperation/${state.userId}/uploads/${change.blob.hash}`
      let blob = await readFile(handle, staging)
      if (!blob) {
        if (!file || await digest(file) !== change.blob.hash) { mirror.outbox = undefined; await save(); return }
        await writeFile(handle, staging, file); blob = await readFile(handle, staging)
      }
      if (!blob) throw new Error('No se pudo leer el archivo cooperativo local.')
      await uploadCooperationFile(b.id, change.blob.hash, blob, change.blob.mime || 'application/octet-stream', uploadOptions)
      mirror.transfer.completed++; await save()
    }
    const wire = structuredClone(mirror.outbox) as Operation & { changes: (Operation['changes'][number] & { valueFile?: { hash: string; size: number }; baseFile?: { hash: string; size: number } })[] }
    for (const change of wire.changes) if (change.type === 'json') {
      for (const field of ['value', 'base'] as const) if (change[field] !== undefined) {
        const blob = new Blob([JSON.stringify(change[field])], { type: 'application/json' })
        if (blob.size <= 256 * 1024) continue
        const hash = await digest(blob)
        await uploadCooperationFile(b.id, hash, blob, 'application/json', uploadOptions)
        change[field === 'value' ? 'valueFile' : 'baseFile'] = { hash, size: blob.size }
        delete change[field]
      }
    }
    await cooperationApi(`spheres/${b.id}/operations`, wire)
    // Do not clear the durable outbox until the corresponding snapshot is local.
  }
  const remote = mirror.incoming || await cooperationApi(`spheres/${b.id}/snapshot`) as Snapshot
  await prepareBinding(b, remote.resources)
  for (const key of Object.keys(remote.resources)) if (/^(?:teoria|practica)\/.+\.pdf$/i.test(key)) {
    const canonical = `workspace://${key}`, local = mapBindingText(canonical, b, true)
    if (canonical !== local) b.pathAliases = { ...b.pathAliases, [await digest(new Blob([canonical]))]: await digest(new Blob([local])) }
  }
  const previous = mirror.baseline
  if (!mirror.incoming) mirror.incomingApplied = []
  mirror.incomingApplied ||= []
  mirror.incoming = remote
  await save() // An interrupted download resumes before any new local publication.
  if (remote.resources['sphere.json']?.deleted) {
    if (!previous.resources['sphere.json']?.deleted) protectDeletions(b.id, 'sphere.json', previous.resources['sphere.json']?.value, undefined, current.get('sphere.json')?.value)
    mirror.baseline = remote; mirror.outbox = undefined; mirror.incoming = undefined; delete mirror.incomingApplied
    await save()
    window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: b }))
    return
  }
  const priority = (r: Resource) => metadataResource(r) ? 0 : r.type === 'blob' ? 1 : 2
  const incomingSelection = mirror.selection ? await selectionResources(remote.resources, mirror.selection.excludedWeeks) : null
  const incomingAllowed = incomingSelection?.allowed
  const incomingResources = Object.entries(remote.resources).filter(([key]) => !incomingAllowed || incomingAllowed.has(key)).sort(([, a], [, b]) => priority(a) - priority(b))
  mirror.transfer = { phase: 'downloading', completed: 0, total: incomingResources.filter(([key,r]) => r.blob && !mirror.incomingApplied!.includes(key) && (!eq(previous.resources[key],r) || mirror.downloading)).length }
  let metadataExposed = false
  const changedMetadata = incomingResources.some(([key,r]) => metadataResource(r) && !eq(previous.resources[key],r))
  const exposeMetadata = async () => {
    if (metadataExposed || (!mirror.downloading && !changedMetadata)) return
    metadataExposed = true
    const metadata = remote.resources['sphere.json']?.value
    if (record(metadata)) { if (typeof metadata.name === 'string') b.name = metadata.name; if (typeof metadata.color === 'string') b.color = metadata.color }
    mirror.metadataReady = true
    await installSubject(b); await save()
    window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: b }))
  }
  for (const [key, rawResource] of incomingResources) {
    const resource = key === 'scope/tags.json' && incomingSelection ? { ...rawResource, value: projectSelectionTags(rawResource.value, incomingSelection.materialIds) } : rawResource
    if (!metadataResource(resource)) await exposeMetadata()
    if (mirror.incomingApplied.includes(key)) continue
    const rawPrior = previous.resources[key]
    const prior = key === 'scope/tags.json' && incomingSelection && rawPrior ? { ...rawPrior, value: projectSelectionTags(rawPrior.value, incomingSelection.materialIds) } : rawPrior, local = current.get(key)
    if (state.deletions.some(d => d.sphereId === b.id && d.key === key && !d.selector.length && d.decision !== 'wait')) continue
    if (eq(prior, resource) && !mirror.downloading) continue
    if (resource.deleted) {
      if (key.startsWith('scope/board-assets/')) continue
      if (local && !prior?.deleted) {
        if (key.startsWith('manifests/materials/') || key.startsWith('manifests/entries/')) {
          const field = key.startsWith('manifests/materials/') ? 'materials' : 'entries'
          const base = prior?.value as Record<string, Json> | undefined
          const value = local.value as Record<string, Json> | undefined
          protectDeletions(b.id, key, { [field]: base?.[field] || [] }, { [field]: [] }, { [field]: value?.[field] || [] })
        } else if (!prior?.blob || !Object.values(previous.resources).some(r => r.type === 'json' && JSON.stringify(r.value).includes(key))) {
          protectDeletions(b.id, key, prior?.value ?? (prior?.blob ? { file: key } : undefined), undefined, local.value ?? (local.blob ? { file: key } : undefined))
        }
      }
      continue
    }
    if (resource.type === 'blob' && resource.blob) {
      const response = await fetch(`/pizarra/api/cooperation/spheres/${b.id}/files/${resource.blob.hash}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`No se pudo descargar ${key}.`)
      const blob = await response.blob()
      if (blob.size !== resource.blob.size || await digest(blob) !== resource.blob.hash) throw new Error(`La descarga de ${key} no pasó la verificación.`)
      const temp = `.cooperation/${state.userId}/downloads/${resource.blob.hash}`
      await writeFile(handle, temp, blob)
      // Preserve a newer local file if it changed during the transfer.
      const latest = await readFile(handle, mapBindingText(key, b, true))
      if (!key.startsWith('scope/') && mirror.downloading && mirror.metadataReady && latest && await digest(latest) !== resource.blob.hash) {
        // The newly visible subject may already have a local edit. Keep it;
        // the next normal reconciliation will publish it against this snapshot.
        await removeFile(handle, temp); mirror.incomingApplied.push(key); mirror.transfer.completed++; await save(); continue
      }
      if (!key.startsWith('scope/') && !mirror.downloading && local?.blob && (!latest || await digest(latest) !== await digest(local.blob))) continue
      await applyMirrorFile(handle, b, key, (await readFile(handle, temp))!)
      await removeFile(handle, temp)
      mirror.incomingApplied.push(key)
      mirror.transfer.completed++; await save()
    } else if (resource.type === 'json' && resource.value !== undefined) {
      let localValue = local?.value
      if (key.startsWith('scope/') && (!mirror.downloading || mirror.metadataReady)) localValue = (await scanSphere(handle, b)).find(file => file.key === key)?.value
      if (!key.startsWith('scope/') && key !== 'sphere.json' && (!mirror.downloading || mirror.metadataReady)) {
        const latest = await readFile(handle, mapBindingText(key, b, true))
        localValue = latest ? mapBindingJson(JSON.parse(await latest.text()), b, false) : undefined
      }
      const protect = key.startsWith('manifests/materials/') || key.startsWith('manifests/entries/') || key === 'scope/containers.json' || /^manifests\/subject-voice\/[^/]+\/workspace\.json$/.test(key) || key.startsWith('manifests/subject-voice/topics/')
      if (protect) protectDeletions(b.id, key, prior?.value, resource.value, localValue)
      const conflicts: Parameters<typeof mergeCooperation>[3] = []
      let merged = mirror.downloading && (!mirror.metadataReady || localValue === undefined) ? resource.value : mergeCooperation(prior?.value, localValue, resource.value, conflicts)
      for (const pending of state.deletions.filter(d => d.sphereId === b.id && d.key === key && d.decision !== 'delete')) merged = setSelected(merged, pending.selector, select(localValue, pending.selector))
      if (conflicts.length) await writeJson(handle, `.cooperation/${state.userId}/recovery/${b.id}-${remote.seq}-${await digest(new Blob([key]))}.json`, { key, conflicts })
      if (merged !== undefined) await applyMirrorFile(handle, b, key, merged)
      mirror.incomingApplied.push(key)
    }
  }
  await exposeMetadata()
  if (remote.conflicts.length) await writeJson(handle, `.cooperation/${state.userId}/recovery/${b.id}-server.json`, remote.conflicts)
  mirror.baseline = remote; mirror.outbox = undefined; mirror.incoming = undefined; mirror.downloading = false; delete mirror.error; delete mirror.transfer; delete mirror.incomingApplied
  const metadata = remote.resources['sphere.json']?.value
  if (record(metadata)) { if (typeof metadata.name === 'string') b.name = metadata.name; if (typeof metadata.color === 'string') b.color = metadata.color }
  if (wasDownloading || metadata) await installSubject(b)
  if (!moreChanges && revision === syncRevision) confirmedMirrors.add(b.id)
  await save()
  window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: b }))
  connectMirror(b.id)
  return moreChanges
}
async function connectMirror(id: string) {
  if (sockets.has(id)) return
  try {
    const { url } = await cooperationApi(`spheres/${id}/ticket`, {})
    if (sockets.has(id)) return
    const socket = new WebSocket(url); sockets.set(id, socket)
    socket.onmessage = event => { try {
      const message = JSON.parse(event.data)
      if (message.type === 'changed') { invalidateSyncStatus(); void synchronizeCooperation() }
      if (message.type === 'presence') { presences.set(id, message); window.dispatchEvent(new CustomEvent('cursado-cooperation-presence', { detail: { sphereId: id, ...message } })) }
      if (message.type === 'editor') window.dispatchEvent(new CustomEvent('cursado-cooperation-editor', { detail: { sphereId: id, ...message } }))
    } catch {} }
    socket.onclose = () => { if (sockets.get(id) === socket) sockets.delete(id); presences.delete(id); window.dispatchEvent(new CustomEvent('cursado-cooperation-presence', { detail: { type: 'presence', sphereId: id, users: [], connected: false } })) }
    socket.onerror = () => socket.close()
  } catch { /* The periodic reconciliation retries a failed connection. */ }
}
let syncing: Promise<void> | null = null
function synchronizeInBackground() {
  void synchronizeCooperation().catch(error => {
    state.error = error instanceof Error ? error.message : String(error); cooperationChanged()
  })
}
export function synchronizeCooperation(): Promise<void> {
  if (syncing) return syncing
  const work = async () => {
    if (!state.userId || navigator.onLine === false) return
    const execute = async () => {
      for (const mirror of Object.values(state.mirrors)) {
        try { while (await synchronizeMirror(mirror)) { /* Drain metadata and file batches without waiting for the next poll. */ } }
        catch (error) { confirmedMirrors.delete(mirror.binding.id); mirror.error = error instanceof Error ? error.message : String(error); await save() }
      }
    }
    if (navigator.locks) await navigator.locks.request(`cooperation:${state.userId}`, async () => {
      // Another tab may have acknowledged operations while this tab waited.
      if (activeRoot) state = await readJson(activeRoot, `.cooperation/${state.userId}/state.json`, state)
      await execute()
    }); else await execute()
  }
  syncing = work().finally(() => { syncing = null })
  return syncing
}
async function decideDeletion(id: string, decision: 'wait' | 'keep' | 'delete') {
  const pending = state.deletions.find(d => d.id === id)
  if (!pending) return
  pending.decision = decision; pending.notified = true
  const mirror = state.mirrors[pending.sphereId]
  // Detach all children when keeping a whole sphere, so later changes cannot alter it.
  if (decision === 'keep' && pending.key === 'sphere.json' && mirror) {
    for (const resource of Object.values(mirror.baseline.resources)) {
      if (resource.key === 'sphere.json' || state.deletions.some(d => d.sphereId === pending.sphereId && d.key === resource.key)) continue
      state.deletions.push({ id: JSON.stringify([pending.sphereId, resource.key, []]), sphereId: pending.sphereId, key: resource.key, selector: [], label: resource.key, decision: 'keep', value: resource.value, notified: true })
    }
  }
  // A decision about a PDF also resolves its backing file locally. Never echo
  // local cleanup as a fresh shared deletion, or update a saved personal copy.
  const row = pending.value
  const canonicalFile = record(row) && typeof row.drive_file_id === 'string' && row.drive_file_id.startsWith('workspace://') ? row.drive_file_id.slice(12) : ''
  const detachFile = async () => {
    if (!mirror || !canonicalFile || decision === 'wait') return
    const id = JSON.stringify([pending.sphereId, canonicalFile, []])
    const existing = state.deletions.find(d => d.id === id)
    if (existing) { existing.decision = decision; existing.notified = true }
    else state.deletions.push({ id, sphereId: pending.sphereId, key: canonicalFile, selector: [], label: pending.label, decision, notified: true })
    await save()
  }
  if (decision === 'keep') await detachFile()
  if (decision === 'delete' && mirror) {
    const handle = await root(), key = pending.key
    if (pending.selector.length) {
      const local = (await scanSphere(handle, mirror.binding)).find(f => f.key === key)?.value
      const next = setSelected(local, pending.selector, undefined)
      if (next !== undefined) await applyMirrorFile(handle, mirror.binding, key, next)
    } else if (key === 'sphere.json') {
      const catalog = await readJson<{ version: number; subjects: Record<string, unknown> }>(handle, 'manifests/subject-catalog.json', { version: 2, subjects: {} })
      delete catalog.subjects[mirror.binding.subjectId]
      await writeJson(handle, 'manifests/subject-catalog.json', catalog)
      const files = Object.values(mirror.baseline.resources).map(r => r.key).filter(key => !key.startsWith('scope/') && key !== 'sphere.json').map(key => mapBindingText(key, mirror.binding, true))
      for (const file of files.filter(key => key.startsWith('manifests/') || key.startsWith('progreso/pizarras/'))) await removeFile(handle, file)
      for (const file of files.filter(key => !key.startsWith('manifests/') && !key.startsWith('progreso/pizarras/'))) if (!await isFileReferenced(handle, file)) await removeFile(handle, file)
      window.dispatchEvent(new CustomEvent('cursado-cooperation-remove-subject', { detail: mirror.binding }))
    } else if (!key.startsWith('scope/')) await removeFile(handle, mapBindingText(key, mirror.binding, true))
    const fileId = record(row) && typeof row.drive_file_id === 'string' ? mapBindingText(row.drive_file_id, mirror.binding, true) : ''
    if (fileId.startsWith('workspace://') && !await isFileReferenced(handle, fileId.slice(12))) {
      await detachFile()
      await removeFile(handle, fileId.slice(12))
    }
  }
  await save()
  if (mirror) window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: mirror.binding }))
}
export const decideCooperationDeletion = (id: string, decision: 'wait' | 'keep' | 'delete') => withStateLock(() => decideDeletion(id, decision))
export function cooperationDeletionFor(subjectId: string, elementId?: string | number, fileKey?: string) {
  const mirrors = Object.values(state.mirrors).filter(m => m.binding.subjectId === subjectId)
  const originalId = elementId === undefined ? undefined : canonicalCooperationElement(subjectId, elementId)
  return state.deletions.find(d => mirrors.some(m => m.binding.id === d.sphereId) && d.decision === 'wait' && (fileKey ? mapBindingText(d.key, mirrors.find(m => m.binding.id === d.sphereId)!.binding, true) === fileKey : originalId !== undefined ? d.selector.includes(`@${originalId}`) : d.key === 'sphere.json'))
}
export function cooperationPersonalFor(subjectId: string, elementId: string | number) {
  const originalId = canonicalCooperationElement(subjectId, elementId)
  return state.deletions.some(d => state.mirrors[d.sphereId]?.binding.subjectId === subjectId && d.decision === 'keep' && (d.key === 'sphere.json' || d.selector.includes(`@${originalId}`)))
}
export function canonicalCooperationSubject(subjectId: string) { return Object.values(state.mirrors).find(m => m.binding.subjectId === subjectId)?.binding.sourceId || subjectId }
export function canonicalCooperationElement(subjectId: string, id: string | number) {
  const b = Object.values(state.mirrors).find(m => m.binding.subjectId === subjectId)?.binding
  return typeof id === 'number' ? Number(Object.entries(b?.numberAliases || {}).find(([, local]) => local === id)?.[0] ?? id) : id
}
export function localCooperationBoardId(subjectId: string, id: string) {
  const b = Object.values(state.mirrors).find(m => m.binding.subjectId === subjectId)?.binding
  return b && !b.owner ? `${id}-${b.id.slice(0, 8)}` : id
}
export function cooperationPresence(subjectId: string) {
  const b = Object.values(state.mirrors).find(m => m.binding.subjectId === subjectId)?.binding
  return b ? presences.get(b.id) : undefined
}
export function sendCooperationEditor(subjectId: string, document: string, payload: unknown) {
  const b = Object.values(state.mirrors).find(m => m.binding.subjectId === subjectId)?.binding
  const socket = b && sockets.get(b.id)
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'editor', document: mapBindingText(document, b!, false), payload }))
}
export async function guardCooperationElement(subjectId: string, elementId: string | number | undefined, open: () => void, fileKey?: string) {
  const pending = cooperationDeletionFor(subjectId, elementId, fileKey)
  if (!pending) { open(); return }
  window.dispatchEvent(new CustomEvent('cursado-cooperation-review', { detail: { pending, open } }))
}
export async function notifyCooperationDeletion(id: string) { await withStateLock(async () => { const pending = state.deletions.find(d => d.id === id); if (pending) { pending.notified = true; await save() } }) }
export async function dismissCooperationSphere(id: string) { await withStateLock(async () => { state.dismissedSpheres = [...new Set([...(state.dismissedSpheres || []), id])]; await save() }) }

/** Used by the standalone PDF viewer, which may outlive its originating Study tab. */
export function startCooperationBackground() {
  let stopped = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    if (stopped || busy) return
    busy = true
    try { await refreshCooperation(); if (!stopped) synchronizeInBackground() }
    catch (error) {
      if (!stopped && !state.userId) await restoreCooperationOffline().catch(() => {})
      if (!stopped) { state.error = error instanceof Error ? error.message : String(error); cooperationChanged() }
    }
    finally { busy = false }
  }
  const saved = () => { invalidateSyncStatus(); clearTimeout(timer); timer = setTimeout(() => { void refresh() }, 250) }
  const channel = new BroadcastChannel('cursado-library-changes')
  channel.onmessage = saved
  window.addEventListener('online', refresh); window.addEventListener('focus', refresh); window.addEventListener('cursado-workspace-saved', saved)
  window.addEventListener('offline', invalidateSyncStatus)
  const interval = setInterval(() => void refresh(), 4000)
  void refresh()
  return () => { stopped = true; clearTimeout(timer); clearInterval(interval); channel.close(); for (const socket of sockets.values()) socket.close(); sockets.clear(); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('cursado-workspace-saved', saved); window.removeEventListener('offline', invalidateSyncStatus) }
}
