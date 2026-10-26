'use client'
import { createIdleSync } from './idle-sync.ts'
import { withWorkspaceFileLock } from '../workspace-file-lock.ts'
import { uploadCooperationFile } from './cooperation-upload.ts'
import { cooperationRequest } from './cooperation-request.ts'
import { cooperationResourceBytes, cooperationSyncLabel } from '../cooperation-sync-status.ts'
import { projectSelectionTags, selectionResources, type WeekSelection } from './cooperation-selection.ts'
import { COOPERATIVE_TAB_ID, mergeCooperation, type Json } from '../cooperation-model.ts'
import { getReadyInscreenConfigToken, getReadyWorkspaceHandle, loadServicesFile, loadWorkspaceHandle, queryWorkspacePermission } from '../local-workspace-client.ts'
import { applyMirrorFile, digest, isFileReferenced, mapBindingJson, mapBindingText, readFile, readJson, removeFile, scanSphere, writeFile, writeJson, type SphereBinding } from './cooperation-files.ts'

export type CooperativeSphere = { id: string; group_id: string; name: string; color: string; created_by: string; bytes: number; ready?: boolean }
export type CooperativeGroup = { id: string; accepted: boolean; members: { id: string; display_name: string }[]; spheres: CooperativeSphere[]; importantShares?: CooperativeSphere[] }
export type Resource = { key: string; type: 'json' | 'blob' | 'delete'; value?: Json; blob?: { hash: string; size: number; mime: string }; deleted?: boolean; seq?: number; author?: string }
type Snapshot = { seq: number; resources: Record<string, Resource>; conflicts: Json[] }
type Operation = { id: string; changes: (Resource & { base?: Json; baseHash?: string })[] }
export type PendingDeletion = { id: string; sphereId: string; key: string; selector: string[]; value?: Json; label: string; decision: 'wait' | 'keep' | 'delete'; notified?: boolean }
type Mirror = { repair?: { originalId: string; groupIds: string[]; seq: number; files: { path: string; hash: string; sourcePath: string; sourceHash: string }[] }; copiedFrom?: string; copySource?: {subjectId:string;storageKey:string}; selection?: WeekSelection; binding: SphereBinding; baseline: Snapshot; outbox?: Operation; incoming?: Snapshot; incomingApplied?: string[]; downloading?: boolean; metadataReady?: boolean; transfer?: { phase: 'copying' | 'uploading' | 'checking' | 'downloading'; completed: number; total: number }; error?: string }
export type CooperationState = { version: 1; userId: string; groups: CooperativeGroup[]; mirrors: Record<string, Mirror>; deletions: PendingDeletion[]; dismissedSpheres?: string[]; removedSpheres?: string[]; error?: string }
let state: CooperationState = { version: 1, userId: '', groups: [], mirrors: {}, deletions: [] }
let activeRoot: FileSystemDirectoryHandle | null = null
const sockets = new Map<string, WebSocket>()
const connectingSockets = new Set<string>()
let connectionGeneration = 0
let requestDiscovery: (() => void) | null = null
let retryBackground: (() => void) | null = null
let connectedBackground: (() => void) | null = null
let backgroundUsers = 0
let stopBackground: (() => void) | null = null
const presences = new Map<string, { users: { id: string; name: string; color: string; emoji: string; client_ids: string[] }[]; you: string }>()
export const cooperationState = () => state
const confirmedMirrors = new Set<string>()
const undoingSpheres = new Set<string>()
// Persist cancellation synchronously, before waiting for a transfer or disk lock.
function pendingUndoIds(): string[] {
  try { return JSON.parse(localStorage.getItem(`cursado-cooperation-undo:${state.userId}`) || '[]') } catch { return [] }
}
function persistUndo(ids: string[]) {
  localStorage.setItem(`cursado-cooperation-undo:${state.userId}`, JSON.stringify(ids))
}
async function resumePendingUndos() {
  for (const id of pendingUndoIds()) {
    if (state.mirrors[id]?.binding.owner) await undoCooperationSphere(id)
  }
}
const isUndoPending = (id: string) => undoingSpheres.has(id) || pendingUndoIds().includes(id)

type UndoStage = 'stopping' | 'remote' | 'local'
const undoStages = new Map<string, UndoStage>()
export const cooperationUndoStatus = (sphereId: string) => undoStages.get(sphereId)
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
export function reportCooperationError(reason: unknown) {
  state.error = reason instanceof Error ? reason.message : String(reason)
  cooperationChanged()
}
export const cooperationApi = cooperationRequest
async function root() {
  const handle = getReadyWorkspaceHandle() || await loadWorkspaceHandle()
  if (!handle || await queryWorkspacePermission(handle, 'readwrite') !== 'granted') throw new Error('Abrí Estudio y autorizá tu carpeta local para cooperar.')
  return handle
}
let saveQueue: Promise<unknown> = Promise.resolve()
async function save() {
  cooperationChanged()
  const handle = activeRoot, userId = state.userId, snapshot = structuredClone(state)
  if (handle && userId) {
    const write = () => writeJson(handle, `.cooperation/${userId}/state.json`, snapshot)
    saveQueue = saveQueue.then(write, write)
    await saveQueue
  }
  cooperationChanged()
}
let stateLockQueue: Promise<unknown> = Promise.resolve()
async function withCooperationLock<T>(work: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(`cooperation:${state.userId}`, work)
  const pending = stateLockQueue.then(work, work)
  stateLockQueue = pending.then(() => undefined, () => undefined)
  return pending
}
async function withStateLock<T>(work: () => Promise<T>): Promise<T> {
  const run = async () => {
    if (activeRoot && state.userId) state = await readJson(activeRoot, `.cooperation/${state.userId}/state.json`, state)
    return work()
  }
  return withCooperationLock(run)
}
export async function refreshCooperation() {
  const result = await cooperationApi('groups') as { user: { id: string }; groups: CooperativeGroup[] }
  const handle = await root()
  if (syncing && state.userId === result.user.id && activeRoot === handle) {
    // Discovery must stay responsive while a PDF is transferring. The active
    // synchronization persists this directory update with its next checkpoint.
    state.groups = result.groups.map(group=>({...group,spheres:group.spheres.filter(sphere=>!state.removedSpheres?.includes(sphere.id))})); delete state.error; cooperationChanged(); return state
  }
  if (syncing) await syncing
  if (state.userId !== result.user.id || activeRoot !== handle) {
    connectionGeneration++
    confirmedMirrors.clear()
    for (const socket of sockets.values()) socket.close()
    sockets.clear(); presences.clear()
    activeRoot = handle
    state = await readJson(handle, `.cooperation/${result.user.id}/state.json`, { version: 1, userId: result.user.id, groups: [], mirrors: {}, deletions: [] } as CooperationState)
    localStorage.setItem('cursado-cooperation-user', result.user.id)
  }
  await withStateLock(async () => { state.groups = result.groups.map(group=>({...group,spheres:group.spheres.filter(sphere=>!state.removedSpheres?.includes(sphere.id))})); delete state.error; await save() })
  await resumePendingUndos()
  return state
}
export async function restoreCooperationOffline() {
  const userId = localStorage.getItem('cursado-cooperation-user')
  if (!userId) return
  activeRoot = await root()
  state = await readJson(activeRoot, `.cooperation/${userId}/state.json`, { version: 1, userId, groups: [], mirrors: {}, deletions: [] } as CooperationState)
  cooperationChanged()
  await resumePendingUndos()
}
export async function createCooperationGroup(names: string) {
  const result = await cooperationApi('groups', { names })
  await refreshCooperation()
  return result.id as string
}
export async function acceptCooperationGroup(groupId: string) {
  await cooperationApi(`groups/${groupId}/accept`, {})
  await refreshCooperation()
}
export async function removeLocalCooperationSubjects(subjectIds: string[]) {
  if (!state.userId || activeRoot !== await root()) await restoreCooperationOffline()
  const ids = new Set(subjectIds)
  const pending = Object.values(state.mirrors).filter(m => ids.has(m.binding.subjectId)).map(m => m.binding.id)
  for (const id of pending) undoingSpheres.add(id)
  try {
    if (syncing) await syncing
    await withStateLock(async () => {
      const mirrors = Object.values(state.mirrors).filter(m => ids.has(m.binding.subjectId))
      const removed = new Set([...(state.removedSpheres || []), ...mirrors.map(m => m.binding.id)])
      state.removedSpheres = [...removed]
      state.dismissedSpheres = [...new Set([...(state.dismissedSpheres || []), ...removed])]
      for (const mirror of mirrors) {
        delete state.mirrors[mirror.binding.id]
        sockets.get(mirror.binding.id)?.close(); sockets.delete(mirror.binding.id); confirmedMirrors.delete(mirror.binding.id)
      }
      state.deletions = state.deletions.filter(item => !removed.has(item.sphereId))
      state.groups = state.groups.map(group => ({ ...group, spheres: group.spheres.filter(sphere => !removed.has(sphere.id)) }))
      await save()
    })
  } finally { for (const id of pending) undoingSpheres.delete(id) }
}
export async function undoCooperationSphere(sphereId: string) {
  const mirror=state.mirrors[sphereId]
  if(!mirror?.binding.owner)throw new Error('Solo se puede deshacer un intento propio.')
  if(undoingSpheres.has(sphereId))return
  persistUndo([...new Set([...pendingUndoIds(), sphereId])])
  undoingSpheres.add(sphereId)
  const stage = (value: UndoStage) => { undoStages.set(sphereId, value); cooperationChanged() }
  delete state.error
  stage('stopping')
  try {
    if(syncing)await syncing
    await withStateLock(async()=>{
      stage('remote')
      let detached = false
      try {
        const response = await fetch(`/pizarra/api/cooperation/spheres/${sphereId}/undo`, {
          method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8_000),
        })
        detached = !response.ok
        await response.body?.cancel()
      } catch { detached = true }
      // Cancelling this PC's association must not depend on deleting the remote
      // publication. Keep the local subject when offline or after a 409, and
      // leave any other participants' shared content intact.
      const current=state.mirrors[sphereId]
      if(!current){cooperationChanged();return}
      stage('local')
      const b=current.binding,removedCopy=!detached&&!!current.copiedFrom,handle=await root()
      const catalog=await readJson<{version:number;subjects:Record<string,Record<string,unknown>>}>(handle,'manifests/subject-catalog.json',{version:2,subjects:{}})
      if(removedCopy)delete catalog.subjects[b.subjectId]
      else if(catalog.subjects[b.subjectId]?.cooperationId===b.id)delete catalog.subjects[b.subjectId].cooperationId
      await writeJson(handle,'manifests/subject-catalog.json',catalog)
      const workspace=await readJson<Record<string,any>>(handle,'manifests/workspace-state.json',{})
      for (const [id,tab] of Object.entries(workspace.workspaceTabs || {}) as [string,{subjectIds?:string[]}][]) {
        if(removedCopy || id.startsWith('cooperative-'))tab.subjectIds=(tab.subjectIds||[]).filter(subjectId=>subjectId!==b.subjectId)
      }
      if(removedCopy && workspace.customSubjects)delete workspace.customSubjects[b.subjectId]
      else if(workspace.customSubjects?.[b.subjectId]?.tabId===cooperationGroupTab(b.groupId)){workspace.customSubjects[b.subjectId].tabId='main';workspace.isMainWorkspaceTabVisible=true}
      await writeJson(handle,'manifests/workspace-state.json',workspace)
      delete state.mirrors[sphereId]
      state.removedSpheres=[...new Set([...(state.removedSpheres||[]),sphereId])]
      state.dismissedSpheres=[...new Set([...(state.dismissedSpheres||[]),sphereId])]
      delete state.error
      state.deletions=state.deletions.filter(item=>item.sphereId!==sphereId)
      for(const group of state.groups)group.spheres=group.spheres.filter(sphere=>sphere.id!==sphereId)
      sockets.get(sphereId)?.close();sockets.delete(sphereId);confirmedMirrors.delete(sphereId)
      await save()
      persistUndo(pendingUndoIds().filter(id => id !== sphereId))
      window.dispatchEvent(new CustomEvent('cursado-cooperation-undone',{detail:{binding:b,removedCopy}}))
    })
  } catch (error) { state.error=error instanceof Error?error.message:String(error);throw error }
  finally {undoingSpheres.delete(sphereId);undoStages.delete(sphereId);cooperationChanged()}
}
async function installSubject(b: SphereBinding, groupId = b.groupId) {
  const handle = await root(), timestamp = new Date().toISOString()
  const catalog = await readJson<{ version: number; subjects: Record<string, Record<string, unknown>> }>(handle, 'manifests/subject-catalog.json', { version: 2, subjects: {} })
  const current = catalog.subjects[b.subjectId]
  if (!current || current.name !== b.name || current.cooperationId !== b.id) {
    catalog.subjects[b.subjectId] = { ...current, id: b.subjectId, cooperationId: b.id, name: b.name, storageKey: b.storageKey, normalizedName: b.name.toLowerCase(), createdAt: current?.createdAt || timestamp, updatedAt: timestamp }
    await writeJson(handle, 'manifests/subject-catalog.json', catalog)
  }
  const workspace = await readJson<Record<string, Json>>(handle, 'manifests/workspace-state.json', { workspaceTabs: {}, customSubjects: {}, subjectWeekdays: {}, activeWorkspaceTabId: 'main', isMainWorkspaceTabVisible: true })
  const before = JSON.stringify(workspace), tabs = workspace.workspaceTabs as Record<string, Record<string, Json>>, subjects = workspace.customSubjects as Record<string, Record<string, Json>>
  const tabId = cooperationGroupTab(groupId), group = state.groups.find(g => g.id === groupId)
  tabs[tabId] ||= { id: tabId, name: group?.members.map(m => m.display_name).join(', ') || 'Cooperativo', color: '#16a34a', createdAt: timestamp, subjectIds: [] }
  for (const id of new Set([groupId, ...state.groups.filter(g => g.spheres.some(s => s.id === b.id)).map(g => g.id)])) {
    const key = cooperationGroupTab(id), linkedGroup = state.groups.find(g => g.id === id)
    tabs[key] ||= { id: key, name: linkedGroup?.members.map(m => m.display_name).join(', ') || 'Cooperativo', color: '#16a34a', createdAt: timestamp, subjectIds: [] }
    tabs[key].subjectIds = [...new Set([...(tabs[key].subjectIds as string[]), b.subjectId])]
  }
  subjects[b.subjectId] = { id: b.subjectId, tabId: b.owner && !state.mirrors[b.id]?.copiedFrom ? 'main' : tabId, createdAt: timestamp, targetWeekday: 0, ...subjects[b.subjectId], storageKey: b.storageKey, name: b.name, color: b.color }
  if (JSON.stringify(workspace) !== before) await writeJson(handle, 'manifests/workspace-state.json', workspace)
  window.dispatchEvent(new CustomEvent('cursado-cooperation-subject', { detail: b }))
}
async function prepareCooperationCopy(mirror:Mirror) {
  if(!mirror.copySource)return
  const handle=await root(),source=mirror.copySource,b=mirror.binding
  const files=await scanSphere(handle,{...b,subjectId:source.subjectId,storageKey:source.storageKey,sourceId:source.subjectId,sourceKey:source.storageKey})
  mirror.transfer={phase:'copying',completed:0,total:files.length};await save()
  const resources=Object.fromEntries(files.map(file=>[file.key,{key:file.key,type:file.blob?'blob':'json',value:file.value}])) as Record<string,Resource>
  const copy:SphereBinding={...b,owner:false,sourceId:source.subjectId,sourceKey:source.storageKey}
  await prepareBinding(copy,resources)
  // Binary assets precede manifests that reference them. The pending marker
  // survives failures, so a retry reuses this destination instead of duplicating it.
  for(const file of [...files.filter(file=>file.blob),...files.filter(file=>!file.blob)]) {
    const value=file.blob??structuredClone(file.value!)
    if(file.key.startsWith('progreso/pizarras/') && record(value))delete value.sharedBoard
    await applyMirrorFile(handle,copy,file.key,value)
    mirror.transfer.completed++
    if(mirror.transfer.completed%10===0)await save();else cooperationChanged()
  }
  delete mirror.copySource;delete mirror.transfer;delete mirror.error
  await installSubject(b)
  await save()
}
export async function shareCooperationSphere(groupId: string, subject: { id: string; name: string; color: string; storageKey?: string }, options: { background?: boolean; copy?: boolean } = {}) {
  await refreshCooperation()
  const group=state.groups.find(group=>group.id===groupId)
  if(!group)throw new Error('Este grupo ya no está disponible. Volvé a abrir Referenciar archivos en….')
  if(!group.accepted)await acceptCooperationGroup(groupId)
  // The catalogue is the durable identity of an installed sphere, even when
  // its sync checkpoint was lost. Reattach it before considering publication.
  const localCatalog = await readJson<{ subjects: Record<string, { cooperationId?: string }> }>(await root(), 'manifests/subject-catalog.json', { subjects: {} })
  const installedId = localCatalog.subjects[subject.id]?.cooperationId
  if (installedId && !state.mirrors[installedId]) {
    let installed = state.groups.flatMap(group => group.spheres).find(sphere => sphere.id === installedId)
    if (!installed) {
      const directory = await cooperationApi('groups') as { groups: CooperativeGroup[] }
      installed = directory.groups.flatMap(group => group.spheres).find(sphere => sphere.id === installedId)
    }
    if (!installed) throw new Error('No se pudo recuperar el acceso a la esfera compartida. Reintentá para conservar su identidad.')
    await acceptCooperationSphere(installed)
  }
  const binding = await withStateLock(async () => {
  const sharedElsewhere = Object.values(state.mirrors).find(m => m.binding.subjectId === subject.id)
  if (sharedElsewhere) {
    await cooperationApi('spheres', { groupId, sphereId: sharedElsewhere.binding.id, name: sharedElsewhere.binding.name, color: sharedElsewhere.binding.color })
    await installSubject(sharedElsewhere.binding, groupId)
    await save()
    return sharedElsewhere.binding
  }
  const result = await cooperationApi('spheres', { groupId, name: subject.name, color: subject.color })
  const catalog = await readJson<{ subjects: Record<string, { storageKey: string }> }>(await root(), 'manifests/subject-catalog.json', { subjects: {} })
  const key = subject.storageKey || catalog.subjects[subject.id]?.storageKey || subject.id
  const subjectId=subject.id,storageKey=key
  const binding: SphereBinding = { id: result.id, groupId, subjectId, storageKey, sourceId: subjectId, sourceKey: storageKey, name: subject.name, color: subject.color, owner: true }
  state.mirrors[result.id] = { binding, baseline: { seq: 0, resources: {}, conflicts: [] } }
  await installSubject(binding)
  await save()
  return binding
  })
  if(binding.groupId !== groupId) { await refreshCooperation(); return binding }
  await withStateLock(async()=>{
    const mirror=state.mirrors[binding.id]
    try{await prepareCooperationCopy(mirror)}catch(reason){mirror.error=reason instanceof Error?reason.message:String(reason);await save();throw reason}
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
  state.removedSpheres = state.removedSpheres?.filter(id => id !== sphere.id)
  state.dismissedSpheres = state.dismissedSpheres?.filter(id => id !== sphere.id)
  if (state.mirrors[sphere.id]) await installSubject(state.mirrors[sphere.id].binding, sphere.group_id)
  if (!state.mirrors[sphere.id]) {
    const catalog = await readJson<{ subjects: Record<string, { storageKey: string; cooperationId?: string }> }>(handle, 'manifests/subject-catalog.json', { subjects: {} })
    // A catalogue association survives a lost/rebuilt sync state. Restore that
    // association instead of allocating another local subject.
    let existing = Object.entries(catalog.subjects).find(([, item]) => item.cooperationId === sphere.id)
    if (!existing) {
      const candidate = catalog.subjects[String(meta.subjectId)]
      if (candidate && !candidate.cooperationId && candidate.storageKey === meta.storageKey) {
        // Legacy local subjects have no global identity. Require matching actual
        // content, never just a display name, before attaching remote access.
        const probe: SphereBinding = { id: sphere.id, groupId: sphere.group_id, subjectId: String(meta.subjectId), storageKey: candidate.storageKey, sourceId: String(meta.subjectId), sourceKey: String(meta.storageKey), name: sphere.name, color: sphere.color, owner: false, reuseLocalIds: true }
        const local = await scanSphere(handle, probe)
        const evidence = local.filter(file => !file.key.startsWith('scope/'))
        let matches = evidence.length > 0
        for (const file of evidence) {
          const remote = snapshot.resources[file.key]
          if (!remote || remote.deleted || (file.blob ? remote.blob?.hash !== await digest(file.blob) : JSON.stringify(remote.value) !== JSON.stringify(file.value))) { matches = false; break }
        }
        if (matches) existing = [String(meta.subjectId), candidate]
      }
    }
    const subjectId = existing?.[0] || `coop-${sphere.id}`, storageKey = existing?.[1].storageKey || `Cooperativo-${sphere.id}`
    if (!existing && (catalog.subjects[subjectId] || Object.values(catalog.subjects).some(s => s.storageKey === storageKey))) throw new Error('Ya existe una materia con el identificador de esta esfera. No se sobrescribió.')
    state.mirrors[sphere.id] = { binding: { id: sphere.id, groupId: sphere.group_id, subjectId, storageKey, sourceId: String(meta.subjectId), sourceKey: String(meta.storageKey), name: sphere.name, color: sphere.color, owner: false, ...(existing && subjectId === meta.subjectId && storageKey === meta.storageKey ? { reuseLocalIds: true } : {}) }, baseline: { seq: 0, resources: {}, conflicts: [] }, downloading: true, ...(existing ? { metadataReady: true } : {}), ...(options.choose && !existing ? { selection: { choosing: true, excludedWeeks: [], weeks: [] } } : {}) }
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
  if (b.owner || b.reuseLocalIds) return
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
async function preserveUnavailableMirror(mirror: Mirror): Promise<boolean> {
  // A rejected request alone can mean an expired session. Only detach after
  // an authenticated directory read confirms that access really disappeared.
  let directory: { groups: CooperativeGroup[] }
  try { directory = await cooperationApi('groups') as { groups: CooperativeGroup[] } } catch { return false }
  const b = mirror.binding
  if (directory.groups.some(group => group.spheres.some(sphere => sphere.id === b.id))) return false
  const handle = await root()
  await writeJson(handle, `.cooperation/${state.userId}/recovery/unavailable-${b.id}.json`, mirror)
  const catalog = await readJson<{ subjects: Record<string, { cooperationId?: string }> }>(handle, 'manifests/subject-catalog.json', { subjects: {} })
  if (catalog.subjects[b.subjectId]?.cooperationId === b.id) delete catalog.subjects[b.subjectId].cooperationId
  await writeJson(handle, 'manifests/subject-catalog.json', catalog)
  const workspace = await readJson<Record<string, any>>(handle, 'manifests/workspace-state.json', {})
  if (workspace.customSubjects?.[b.subjectId]) { workspace.customSubjects[b.subjectId].tabId = 'main'; workspace.isMainWorkspaceTabVisible = true }
  for (const [id, tab] of Object.entries(workspace.workspaceTabs || {}) as [string, { subjectIds?: string[] }][]) if (id.startsWith('cooperative-')) tab.subjectIds = (tab.subjectIds || []).filter(subjectId => subjectId !== b.subjectId)
  await writeJson(handle, 'manifests/workspace-state.json', workspace)
  state.removedSpheres = [...new Set([...(state.removedSpheres || []), b.id])]
  state.groups = directory.groups.map(group => ({ ...group, spheres: group.spheres.filter(sphere => !state.removedSpheres?.includes(sphere.id)) }))
  delete state.mirrors[b.id]
  state.deletions = state.deletions.filter(item => item.sphereId !== b.id)
  sockets.get(b.id)?.close(); sockets.delete(b.id); confirmedMirrors.delete(b.id)
  await save()
  window.dispatchEvent(new CustomEvent('cursado-cooperation-undone', { detail: { binding: b, removedCopy: false } }))
  return true
}
async function scanCooperationMirror(handle: FileSystemDirectoryHandle, mirror: Mirror) {
  const b = mirror.binding
  const scan = (resources: Record<string, Resource>) => scanSphere(handle, b, {
    resources,
    restore: async (resource, path) => {
      const response = await fetch(`/pizarra/api/cooperation/spheres/${b.id}/files/${resource.blob!.hash}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`No se pudo recuperar el archivo local «${path}» (HTTP ${response.status}).`)
      const blob = await response.blob()
      if (blob.size !== resource.blob!.size || await digest(blob) !== resource.blob!.hash) throw new Error(`La recuperación de «${path}» no pasó la verificación.`)
      await writeFile(handle, path, blob, true)
    },
  })
  try { return await scan({ ...mirror.baseline.resources, ...mirror.incoming?.resources }) }
  catch (error) {
    if ((error as Error).name !== 'MissingCooperationFileError' || mirror.incoming) throw error
    // A sphere exposes metadata before its uploads finish. A receiver must be
    // able to discover those later files before treating a local absence as a
    // deletion or blocking on its older, metadata-only snapshot.
    const latest = await cooperationApi(`spheres/${b.id}/snapshot`) as Snapshot
    if (latest.seq <= mirror.baseline.seq) throw error
    await prepareBinding(b, latest.resources)
    const files = await scan({ ...mirror.baseline.resources, ...latest.resources })
    mirror.incoming = latest
    mirror.incomingApplied = []
    await save()
    return files
  }
}
async function synchronizeMirror(mirror: Mirror) {
  const revision = syncRevision
  const handle = await root(), b = mirror.binding
  let moreChanges = false
  if (isUndoPending(b.id) || state.removedSpheres?.includes(b.id)) return
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
  let files = mirror.downloading && !mirror.metadataReady ? [] : await scanCooperationMirror(handle, mirror)
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
    let configToken = getReadyInscreenConfigToken()
    if (!configToken) { try { configToken = (await loadServicesFile(handle))?.inscreenToken || '' } catch { /* Personal storage is optional for cooperative transfers. */ } }
    const library = await readJson<{ workspaceId?: string }>(handle, 'manifests/workspace-library-sync.json', {})
    const uploadOptions = { configToken, workspaceId: library.workspaceId }
    mirror.transfer = { phase: 'uploading', completed: 0, total: mirror.outbox.changes.filter(change => change.blob).length }
    await save()
    for (const change of mirror.outbox.changes) if (change.blob) {
      if (isUndoPending(b.id)) return
      const file = current.get(change.key)?.blob
      // A queued file may have changed while offline. Its exact bytes live in staging.
      const staging = `.cooperation/${state.userId}/uploads/${change.blob.hash}`
      let blob = await readFile(handle, staging)
      if (blob && (blob.size !== change.blob.size || await digest(blob) !== change.blob.hash)) {
        await removeFile(handle, staging); blob = null
      }
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
    if (isUndoPending(b.id)) return
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
  const binaries = incomingResources.filter(([key, r]) => !r.deleted && r.blob && (!eq(previous.resources[key], r) || mirror.downloading))
  const applied = new Set(mirror.incomingApplied)
  mirror.transfer = { phase: 'checking', completed: 0, total: binaries.length }
  cooperationChanged()
  // Validate local bytes first, including the publisher's own files. Only missing
  // or different content needs a network transfer. Keep one denominator on retry.
  for (const [key, resource] of binaries) {
    if (isUndoPending(b.id)) return
    if (!applied.has(key)) {
      const destination = key.startsWith('scope/board-assets/') ? `.cooperation/assets/${b.id}/${resource.blob!.hash}` : mapBindingText(key, b, true)
      const existing = await readFile(handle, destination)
      const file = existing || current.get(key)?.blob
      if (file && file.size === resource.blob!.size && await digest(file) === resource.blob!.hash) {
        if (!existing) await applyMirrorFile(handle, b, key, file)
        mirror.incomingApplied.push(key); applied.add(key)
      }
    }
    mirror.transfer.completed++
    cooperationChanged()
  }
  mirror.transfer = { phase: 'downloading', completed: binaries.filter(([key]) => applied.has(key)).length, total: binaries.length }
  await save()
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
    if (isUndoPending(b.id)) return
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
      const destination = key.startsWith('scope/board-assets/') ? `.cooperation/assets/${b.id}/${resource.blob.hash}` : mapBindingText(key, b, true)
      const existingFile = await readFile(handle, destination)
      if (existingFile && existingFile.size === resource.blob.size && await digest(existingFile) === resource.blob.hash) {
        mirror.incomingApplied.push(key); mirror.transfer.completed++; await save(); continue
      }
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
      if (key.startsWith('scope/') && (!mirror.downloading || mirror.metadataReady)) localValue = (await scanCooperationMirror(handle, mirror)).find(file => file.key === key)?.value
      if (!key.startsWith('scope/') && key !== 'sphere.json' && (!mirror.downloading || mirror.metadataReady)) {
        const latest = await readJson<Json | undefined>(handle, mapBindingText(key, b, true), undefined)
        localValue = latest === undefined ? undefined : mapBindingJson(latest, b, false)
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
  // Staging is only needed while an operation is pending. Keeping acknowledged
  // uploads permanently doubles the local storage used by every shared file.
  const uploadedHashes = new Set([...Object.values(remote.resources), ...(mirror.outbox?.changes || [])].flatMap(change => change.blob ? [change.blob.hash] : []))
  mirror.baseline = remote; mirror.outbox = undefined; mirror.incoming = undefined; mirror.downloading = false; delete mirror.error; delete mirror.transfer; delete mirror.incomingApplied
  await save()
  for (const hash of uploadedHashes) await removeFile(handle, `.cooperation/${state.userId}/uploads/${hash}`)
  const metadata = remote.resources['sphere.json']?.value
  if (record(metadata)) { if (typeof metadata.name === 'string') b.name = metadata.name; if (typeof metadata.color === 'string') b.color = metadata.color }
  if (wasDownloading || changedMetadata) await installSubject(b)
  if (!moreChanges && revision === syncRevision) confirmedMirrors.add(b.id)
  await save()
  if (wasDownloading || remote.seq !== previous.seq) window.dispatchEvent(new CustomEvent('cursado-cooperation-applied', { detail: b }))
  connectMirror(b.id)
  return moreChanges
}
/** Repair only copies whose provenance and content prove they are redundant. */
async function repairLegacyCooperationCopies() {
  const handle = await root()
  for (const copy of Object.values(state.mirrors)) {
    if (!copy.copiedFrom || !copy.binding.owner) continue
    try {
      const original = copy.repair ? state.mirrors[copy.repair.originalId] : Object.values(state.mirrors).find(m => !m.copiedFrom && m.binding.subjectId === copy.copiedFrom)
      if (!original || original.downloading || original.copySource || original.outbox || original.selection || copy.selection) continue
      if (!copy.repair) {
        const remote = await cooperationApi(`spheres/${copy.binding.id}/snapshot`) as Snapshot
        // Reconstruct the deterministic ID mapping used by the former copy routine.
        const mapping: SphereBinding = { ...copy.binding, owner: false, reuseLocalIds: false, sourceId: original.binding.sourceId, sourceKey: original.binding.sourceKey, pathAliases: undefined, numberAliases: undefined }
        await prepareBinding(mapping, original.baseline.resources)
        const localCopy = copy.copySource ? [] : await scanSphere(handle, mapping)
        const localOriginal = await scanSphere(handle, original.binding)
        const originals = new Map(localOriginal.map(file => [file.key, file]))
        let identical = true
        for (const file of localCopy) {
          const source = originals.get(file.key)
          if (!source || (file.blob ? !source.blob || await digest(file.blob) !== await digest(source.blob) : !eq(file.value, source.value))) { identical = false; break }
        }
        if (!identical) continue
        for (const resource of Object.values(remote.resources)) {
          if (resource.key === 'sphere.json') continue
          const key = mapBindingText(resource.key, mapping, false), source = originals.get(key)
          if (resource.deleted || !source || (resource.blob ? !source.blob || resource.blob.hash !== await digest(source.blob) : !eq(mapBindingJson(resource.value!, mapping, false), source.value))) { identical = false; break }
        }
        if (!identical) continue
        const groups = state.groups.filter(group => group.spheres.some(sphere => sphere.id === copy.binding.id))
        if (!groups.length || groups.some(group => !group.accepted)) continue
        // Save a recovery record before any remote or local association changes.
        await writeJson(handle, `.cooperation/${state.userId}/recovery/duplicate-${copy.binding.id}.json`, { mirror: copy, remote, originalId: original.binding.id })
        const files: { path: string; hash: string; sourcePath: string; sourceHash: string }[] = []
        for (const file of localCopy) if (!file.key.startsWith('scope/')) {
          const path = mapBindingText(file.key, mapping, true)
          const sourcePath = mapBindingText(file.key, original.binding, true)
          if (path === sourcePath) continue
          const bytes = await readFile(handle, path), sourceBytes = await readFile(handle, sourcePath)
          if (bytes && sourceBytes) files.push({ path, hash: await digest(bytes), sourcePath, sourceHash: await digest(sourceBytes) })
        }
        // Verify again after capturing the raw-file checkpoints: an editor can
        // save while the first comparison is awaiting a hash or a network reply.
        if (!copy.copySource) {
          const latestFiles = await scanSphere(handle, mapping)
          for (const file of latestFiles) {
            const source = originals.get(file.key)
            if (!source || (file.blob ? !source.blob || await digest(file.blob) !== await digest(source.blob) : !eq(file.value, source.value))) { identical = false; break }
          }
          if (!identical) continue
        }
        copy.repair = { originalId: original.binding.id, groupIds: groups.map(group => group.id), seq: remote.seq, files }
        await save()
      }
      const groups = state.groups.filter(group => copy.repair!.groupIds.includes(group.id))
      for (const group of groups) await cooperationApi('spheres', { groupId: group.id, sphereId: original.binding.id, name: original.binding.name, color: original.binding.color })
      // The room checks the sequence atomically and refuses to discard another
      // participant's edits, including a change arriving after the comparison.
      await cooperationApi(`spheres/${copy.binding.id}/undo`, { expectedSeq: copy.repair.seq })
      const catalog = await readJson<{ subjects: Record<string, unknown> }>(handle, 'manifests/subject-catalog.json', { subjects: {} })
      delete catalog.subjects[copy.binding.subjectId]
      await writeJson(handle, 'manifests/subject-catalog.json', catalog)
      const workspace = await readJson<Record<string, any>>(handle, 'manifests/workspace-state.json', {})
      if (workspace.customSubjects) delete workspace.customSubjects[copy.binding.subjectId]
      for (const tab of Object.values(workspace.workspaceTabs || {}) as { subjectIds?: string[] }[]) tab.subjectIds = (tab.subjectIds || []).filter(id => id !== copy.binding.subjectId)
      await writeJson(handle, 'manifests/workspace-state.json', workspace)
      for (const group of groups) {
        const old = group.spheres.find(sphere => sphere.id === copy.binding.id) || group.spheres.find(sphere => sphere.id === original.binding.id) || { group_id: group.id, created_by: state.userId, bytes: 0 }
        group.spheres = group.spheres.filter(sphere => sphere.id !== copy.binding.id && sphere.id !== original.binding.id)
        group.spheres.push({ ...old, id: original.binding.id, name: original.binding.name, color: original.binding.color })
      }
      original.binding.legacyStorageKeys = [...new Set([...(original.binding.legacyStorageKeys || []), copy.binding.storageKey])]
      state.deletions = state.deletions.filter(item => item.sphereId !== copy.binding.id)
      sockets.get(copy.binding.id)?.close(); sockets.delete(copy.binding.id); confirmedMirrors.delete(copy.binding.id)
      for (const group of groups) await installSubject(original.binding, group.id)
      await save()
      // Keep any file edited since the repair checkpoint for recovery.
      for (const file of copy.repair.files) {
        await withWorkspaceFileLock(`write:${file.sourcePath}`, () => withWorkspaceFileLock(`write:${file.path}`, async () => {
          const current = await readFile(handle, file.path), source = await readFile(handle, file.sourcePath)
          if (current && source && await digest(current) === file.hash && await digest(source) === file.sourceHash) await removeFile(handle, file.path)
        }))
      }
      delete state.mirrors[copy.binding.id]
      await save()
      window.dispatchEvent(new CustomEvent('cursado-cooperation-undone', { detail: { binding: copy.binding, removedCopy: true } }))
    } catch (error) { copy.error = error instanceof Error ? error.message : String(error); await save() }
  }
}
async function connectMirror(id: string) {
  if (isUndoPending(id) || (state.removedSpheres || []).includes(id) || sockets.has(id) || connectingSockets.has(id) || navigator.onLine === false) return
  connectingSockets.add(id)
  const userId = state.userId, directory = id === '@directory', generation = connectionGeneration
  try {
    const { url } = await cooperationApi(directory ? 'notifications/ticket' : `spheres/${id}/ticket`, {})
    if (isUndoPending(id) || (!directory && !state.mirrors[id] && !state.groups.some(g=>g.accepted&&g.importantShares?.some(s=>s.id===id))) || sockets.has(id) || state.userId !== userId || generation !== connectionGeneration) return
    const socket = new WebSocket(url); sockets.set(id, socket)
    let initialChange = true
    socket.onopen = () => connectedBackground?.()
    socket.onmessage = event => { try {
      const message = JSON.parse(event.data)
      if (directory) {
        if (message.type === 'changed' || message.type === 'directory_changed') requestDiscovery?.()
        return
      }
      if (message.type === 'changed') {
        // The server sends its current sequence on every connection. An equal
        // sequence is not a remote edit and must not trigger a full file scan.
        const changed = message.seq > (state.mirrors[id]?.baseline.seq ?? -1) || (!initialChange && !confirmedMirrors.has(id))
        initialChange = false
        if (changed) { invalidateSyncStatus(); synchronizeInBackground() }
      }
      if (message.type === 'presence') { presences.set(id, message); window.dispatchEvent(new CustomEvent('cursado-cooperation-presence', { detail: { sphereId: id, ...message } })) }
      if (message.type === 'editor') window.dispatchEvent(new CustomEvent('cursado-cooperation-editor', { detail: { sphereId: id, ...message } }))
    } catch {} }
    socket.onclose = () => {
      if (sockets.get(id) !== socket) return
      sockets.delete(id)
      if (!directory) { confirmedMirrors.delete(id); presences.delete(id); cooperationChanged(); window.dispatchEvent(new CustomEvent('cursado-cooperation-presence', { detail: { type: 'presence', sphereId: id, users: [], connected: false } })) }
      retryBackground?.()
    }
    socket.onerror = () => socket.close()
  } catch { retryBackground?.() }
  finally { connectingSockets.delete(id); if (generation !== connectionGeneration) retryBackground?.() }
}
let syncing: Promise<void> | null = null
let syncAgain = false
function synchronizeInBackground() {
  void synchronizeCooperation().catch(error => {
    state.error = error instanceof Error ? error.message : String(error); cooperationChanged(); retryBackground?.()
  })
}
export function synchronizeCooperation(): Promise<void> {
  if (syncing) { syncAgain = true; return syncing }
  const work = async () => {
    do {
      syncAgain = false
      if (!state.userId || navigator.onLine === false) return
      const execute = async () => {
        await repairLegacyCooperationCopies()
        for (const mirror of Object.values(state.mirrors)) {
          if(mirror.repair || mirror.copySource || state.removedSpheres?.includes(mirror.binding.id) || isUndoPending(mirror.binding.id))continue
          for (let attempt = 0; attempt < 3; attempt++) {
            try { while (await synchronizeMirror(mirror)) { if(isUndoPending(mirror.binding.id))break }; break }
            catch (error) {
              // An atomic local save can invalidate a File snapshot kept by a
              // long transfer. Re-scan with fresh handles before showing an error.
              if ((error as { status?: number })?.status === 403 && await preserveUnavailableMirror(mirror)) break
              const name = (error as { name?: string })?.name
              if ((name === 'NotFoundError' || name === 'NotReadableError') && attempt < 2) continue
              confirmedMirrors.delete(mirror.binding.id); mirror.error = error instanceof Error ? error.message : String(error); await save(); retryBackground?.()
              break
            }
          }
        }
      }
      await withStateLock(execute)
      if(state.groups.some(g=>g.accepted&&g.importantShares?.length)) await (await import('./important-cooperation')).synchronizeImportantShares()
    } while (syncAgain)
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
  return presences.get(subjectId.startsWith('important-share:')?subjectId.slice(16):b?.id||'')
}
export function sendCooperationEditor(subjectId: string, document: string, payload: unknown) {
  const b = Object.values(state.mirrors).find(m => m.binding.subjectId === subjectId)?.binding
  const socket = sockets.get(subjectId.startsWith('important-share:')?subjectId.slice(16):b?.id||'')
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'editor', document: b?mapBindingText(document, b, false):document, payload }))
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
  backgroundUsers++
  let released = false
  const release = () => { if (released) return; released = true; if (--backgroundUsers === 0) { stopBackground?.(); stopBackground = null } }
  if (stopBackground) return release
  let stopped = false, busy = false, refreshAgain = false, attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  const scheduler = createIdleSync({
    storageKey: 'cursado-cooperation-pending-sync',
    run: async () => {
      if (stopped || !state.userId || navigator.onLine === false) return false
      await synchronizeCooperation()
      const failed = Object.values(state.mirrors).find(mirror => mirror.error)
      if (failed) throw new Error(failed.error)
    },
    isLive: () => [...presences.values()].some(presence => presence.users.some(user => user.id !== state.userId)),
    onError: error => { state.error = error instanceof Error ? error.message : String(error); cooperationChanged() },
  })
  const presenceChanged = () => scheduler.refresh()
  const scheduleRetry = () => {
    if (stopped || retry || !state.userId || navigator.onLine === false) return
    retry = setTimeout(() => { retry = undefined; void refresh() }, Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)))
  }
  const refresh = async () => {
    if (stopped || navigator.onLine === false) return
    if (busy) { refreshAgain = true; return }
    busy = true
    try {
      do {
        refreshAgain = false
        await refreshCooperation()
        if (!stopped) {
          void connectMirror('@directory')
          // Presence must connect before scanning files, so a peer joining can
          // immediately switch pending local changes to live synchronization.
          for (const mirror of Object.values(state.mirrors)) void connectMirror(mirror.binding.id)
          for(const group of state.groups)if(group.accepted)for(const share of group.importantShares||[])void connectMirror(share.id)
          // Deliver rows on discovery even if the sender has gone offline or
          // this browser cannot establish a WebSocket connection.
          if(state.groups.some(group=>group.accepted&&group.importantShares?.length)) await (await import('./important-cooperation')).synchronizeImportantShares()
          scheduler.request()
        }
      } while (refreshAgain && !stopped)
    }
    catch (error) {
      if (!stopped && !state.userId) await restoreCooperationOffline().catch(() => {})
      if (!stopped) { state.error = error instanceof Error ? error.message : String(error); cooperationChanged(); scheduleRetry() }
    }
    finally { busy = false }
  }
  const saved = () => { invalidateSyncStatus(); scheduler.request() }
  requestDiscovery = () => { void refresh() }
  retryBackground = scheduleRetry
  connectedBackground = () => { attempts = 0 }
  let observedUser = state.userId
  const sessionChanged = () => {
    if (state.userId === observedUser) return
    observedUser = state.userId
    if (observedUser) void refresh()
  }
  const channel = new BroadcastChannel('cursado-library-changes')
  channel.onmessage = saved
  window.addEventListener('online', refresh); window.addEventListener('focus', refresh); window.addEventListener('cursado-workspace-saved', saved)
  window.addEventListener('offline', invalidateSyncStatus)
  window.addEventListener('cursado-cooperation-changed', sessionChanged)
  window.addEventListener('cursado-cooperation-presence', presenceChanged)
  if (navigator.onLine === false) void restoreCooperationOffline().catch(() => {})
  else void refresh()
  stopBackground = () => {
    stopped = true; scheduler.stop(); clearTimeout(retry); channel.close()
    connectionGeneration++
    requestDiscovery = null; retryBackground = null; connectedBackground = null
    const activeSockets = [...sockets.values()]; sockets.clear(); presences.clear()
    for (const socket of activeSockets) socket.close()
    window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('cursado-workspace-saved', saved); window.removeEventListener('offline', invalidateSyncStatus)
    window.removeEventListener('cursado-cooperation-changed', sessionChanged)
    window.removeEventListener('cursado-cooperation-presence', presenceChanged)
  }
  return release
}
