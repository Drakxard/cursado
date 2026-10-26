'use client'
import { cooperationApi, cooperationState, refreshCooperation, type Resource } from './cooperation'
import { readJson, writeJson, digest } from './cooperation-files'
import { uploadCooperationFile } from './cooperation-upload'
import { getReadyInscreenConfigToken, getReadyWorkspaceHandle } from '../local-workspace-client'
import { readImportantTasks, writeImportantTasks, type ImportantTask } from '../important-tasks'
import { appendSharedTopics, unionSharedTopics, validSharedImportantRow, type SharedImportantRow } from '../important-sharing'
import { mergeCooperation, type Json } from '../cooperation-model'
import { withWorkspaceFileLock } from '../workspace-file-lock'

type Snapshot = { seq: number; resources: Record<string, Resource> }
type Binding = { taskId: string; deliveryId: string; seen: string[] }
type LocalShare = { baseline: Snapshot; bindings: Binding[]; delivered: string[]; pending?: { id: string; changes: unknown[] }; incoming?: Snapshot }
type State = { shares: Record<string, LocalShare> }
const empty = (): LocalShare => ({ baseline: { seq: 0, resources: {} }, bindings: [], delivered: [] })
const json = (value: unknown) => value as Json
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const rowKey = 'important.json'
function context() {
  const root = getReadyWorkspaceHandle(), user = cooperationState().userId
  if (!root || !user) throw new Error('Abrí tu carpeta de Estudio e iniciá sesión para compartir.')
  return { root, path: `.cooperation/${user}/important.json` }
}
async function upload(id: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' }), hash = await digest(blob)
  await uploadCooperationFile(id, hash, blob, blob.type, { configToken: getReadyInscreenConfigToken() || undefined })
  return { hash, size: blob.size }
}
async function changesFor(id: string, base: Snapshot, values: Record<string, unknown>) {
  const changes = []
  for (const [key, value] of Object.entries(values)) {
    const pointer = (value as { __blob?: { hash: string; size: number; mime: string } })?.__blob
    if (pointer) {
      if (!same(base.resources[key]?.blob, pointer)) changes.push({ key, type: 'blob', blob: pointer, baseHash: base.resources[key]?.blob?.hash })
      continue
    }
    const before = base.resources[key]?.value
    if (same(before, value)) continue
    // Documents travel through verified file uploads, including large boards.
    changes.push({ key, type: 'json', valueFile: await upload(id, value), ...(before === undefined ? {} : { baseFile: await upload(id, before) }) })
  }
  return changes
}
async function scanBoards(root: FileSystemDirectoryHandle, id: string, row: SharedImportantRow, baseline: Snapshot) {
  const values: Record<string, unknown> = {}, visited = new Set<string>()
  const scan = async (boardId: string) => {
    if (visited.has(boardId) || !/^[a-zA-Z0-9-]{1,100}$/.test(boardId)) return
    visited.add(boardId)
    const board = await readJson<any>(root, `progreso/pizarras/${boardId}.json`, null)
    if (!board) return
    const assets: Record<string, { hash: string; size: number; mime: string }> = {}
    for (const [assetId, data] of Object.entries(board.assets || {})) {
      if (typeof data !== 'string') continue
      const old = (baseline.resources[`boards/${boardId}.json`]?.value as any)?.assets?.[assetId]
      if (old) { assets[assetId] = old; values[`assets/${old.hash}`] = { __blob: old }; continue }
      const blob = await (await fetch(data.startsWith('data:') ? data : `data:application/octet-stream;base64,${data}`)).blob(), hash = await digest(blob)
      await uploadCooperationFile(id, hash, blob, blob.type || 'application/octet-stream', { configToken: getReadyInscreenConfigToken() || undefined })
      assets[assetId] = { hash, size: blob.size, mime: blob.type }
      values[`assets/${hash}`] = { __blob: assets[assetId] }
    }
    values[`boards/${boardId}.json`] = { ...board, content: { ...board.content, camera: { x:0,y:0,zoom:1 } }, assets, cooperationSubjectId: `important-share:${id}` }
    for (const shape of board.content?.shapes || []) {
      const target = shape.boardReference?.boardId
      if (typeof target === 'string' && target.startsWith('local:important-')) await scan(target.slice(16))
      else if (typeof target === 'string' && target.startsWith('study-')) await scan(target)
    }
  }
  for (const topic of row.topics) await scan(topic.id)
  return values
}
async function applyBoards(root: FileSystemDirectoryHandle, id: string, snapshot: Snapshot, previous: Snapshot) {
  let changed = false
  for (const [key, resource] of Object.entries(snapshot.resources)) {
    if (!/^boards\/[a-zA-Z0-9-]{1,100}\.json$/.test(key) || !resource.value || resource.deleted || same(resource.value, previous.resources[key]?.value)) continue
    const board = structuredClone(resource.value) as any, path = `progreso/pizarras/${key.slice(7)}`
    await withWorkspaceFileLock(path, async () => {
      const local = await readJson<any>(root, path, null), assets: Record<string, string> = { ...local?.assets }
      for (const [assetId, pointer] of Object.entries(board.assets || {}) as [string, any][]) {
        if (assets[assetId]) continue
        if (!/^[a-f0-9]{64}$/.test(pointer?.hash)) throw new Error('Imagen compartida inválida.')
        const response = await fetch(`/pizarra/api/cooperation/spheres/${id}/files/${pointer.hash}`, { cache: 'no-store' })
        if (!response.ok) throw new Error('No se pudo descargar una imagen compartida.')
        const blob = await response.blob()
        if (blob.size !== pointer.size || await digest(blob) !== pointer.hash) throw new Error('La imagen compartida está incompleta.')
        assets[assetId] = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
      }
      const old = previous.resources[key]?.value as any
      const content = local ? mergeCooperation(old?.content, local.content, board.content) : board.content
      if (local?.content?.camera && content && typeof content === 'object') (content as any).camera = local.content.camera
      await writeJson(root, path, { ...board, content, assets, cooperationSubjectId: `important-share:${id}` })
      changed = true
    })
  }
  return changed
}
export async function shareImportantTasks(groupId: string, taskIds: string[]) {
  await withWorkspaceFileLock('important-sharing', async () => {
    const { root, path } = context(), state = await readJson<State>(root, path, { shares: {} })
    let tasks = await readImportantTasks(root)
    let taskBaseline = structuredClone(tasks)
    for (const taskId of taskIds) {
      const task = tasks.find(t => t.id === taskId)
      if (!task) continue
      if (!task.topicBoardIds) task.topicBoardIds = task.topics.map(() => crypto.randomUUID())
      let id = task.cooperation?.shareId
      const created = await cooperationApi('spheres', { groupId, name: (task.text || 'Importante').slice(0, 150), color: '#8b5cf6', kind: 'important', ...(id ? { sphereId: id } : {}) })
      id = created.id as string
      const local = state.shares[id] ||= empty()
      if (local.pending) {
        // Finish the interrupted delivery before accepting another explicit send.
        await cooperationApi(`spheres/${id}/operations`, local.pending)
        local.pending = undefined
        await writeJson(root, path, state)
        continue
      }
      const remote: Snapshot = await cooperationApi(`spheres/${id}/snapshot`)
      const existing = remote.resources[rowKey]?.value as unknown as SharedImportantRow | undefined
      if (existing && !validSharedImportantRow(existing)) throw new Error('La fila compartida no tiene un formato válido.')
      const deliveryId = crypto.randomUUID()
      const row = unionSharedTopics(existing || { text: task.text, startDate: task.startDate, dueDate: task.dueDate, url: task.url, topics: [], deliveries: [] }, [task])
      row.deliveries = [...row.deliveries, { id: deliveryId, groupId }]
      const values = { ...await scanBoards(root, id, row, remote), 'sphere.json': { name: row.text || 'Importante', color: '#8b5cf6' }, [rowKey]: row }
      local.pending = { id: crypto.randomUUID(), changes: await changesFor(id, remote, values) }
      // Bind before sending: a retry must not insert the sender's own row.
      if (!local.bindings.some(b => b.taskId === task.id)) local.bindings.push({ taskId: task.id, deliveryId, seen: row.topics.map(t => t.id) })
      local.delivered.push(deliveryId)
      task.cooperation = { shareId: id, deliveryId: local.bindings.find(b => b.taskId === task.id)!.deliveryId }
      await writeJson(root, path, state)
      tasks = await writeImportantTasks(root, tasks, taskBaseline)
      taskBaseline = structuredClone(tasks)
      await cooperationApi(`spheres/${id}/operations`, local.pending)
      local.pending = undefined
      await writeJson(root, path, state)
    }
  })
  await refreshCooperation()
  await synchronizeImportantShares()
}
export async function synchronizeImportantShares() {
  return withWorkspaceFileLock('important-sharing', async () => {
    const { root, path } = context(), state = await readJson<State>(root, path, { shares: {} })
    const groups = cooperationState().groups.filter(g => g.accepted), ids = [...new Set(groups.flatMap(g => g.importantShares?.map(s => s.id) || []))]
    let changed = false
    for (const id of ids) {
      const local = state.shares[id] ||= empty()
      if (local.pending) { await cooperationApi(`spheres/${id}/operations`, local.pending); local.pending = undefined; await writeJson(root, path, state) }
      if (local.incoming) {
        changed = await applyBoards(root, id, local.incoming, local.baseline) || changed
        local.baseline = local.incoming; local.incoming = undefined; await writeJson(root, path, state)
      }
      let remote: Snapshot = await cooperationApi(`spheres/${id}/snapshot`)
      const row = remote.resources[rowKey]?.value as unknown as SharedImportantRow | undefined
      if (!row) continue
      if (!validSharedImportantRow(row)) throw new Error('La fila compartida no tiene un formato válido.')
      const baselineTasks = await readImportantTasks(root), tasks = structuredClone(baselineTasks)
      const ownTasks = tasks.filter(task => local.bindings.some(b => b.taskId === task.id))
      const nextRow = unionSharedTopics(row, ownTasks)
      const values = await scanBoards(root, id, nextRow, local.baseline)
      values[rowKey] = nextRow
      const changes = await changesFor(id, local.baseline, values)
      // Row additions were already unioned with the latest remote version.
      const rowChange = changes.findIndex(change => change.key === rowKey)
      if (rowChange >= 0) changes.splice(rowChange, 1)
      changes.push(...await changesFor(id, remote, { [rowKey]: nextRow }))
      if (changes.length) {
        local.pending = { id: crypto.randomUUID(), changes }; await writeJson(root, path, state)
        await cooperationApi(`spheres/${id}/operations`, local.pending)
        local.pending = undefined; await writeJson(root, path, state)
        remote = await cooperationApi(`spheres/${id}/snapshot`)
      }
      const finalRow = remote.resources[rowKey].value as unknown as SharedImportantRow
      if (!validSharedImportantRow(finalRow)) throw new Error('La fila compartida recibida no tiene un formato válido.')
      for (const delivery of finalRow.deliveries) {
        if (local.delivered.includes(delivery.id) || !groups.some(g => g.id === delivery.groupId && g.importantShares?.some(s => s.id === id))) continue
        // The ID makes retries idempotent, while each explicit re-share creates another row.
        const taskId = `shared-${delivery.id}`
        if (!tasks.some(t => t.id === taskId)) tasks.push({ id: taskId, text: finalRow.text, startDate: finalRow.startDate, dueDate: finalRow.dueDate, url: finalRow.url, topics: finalRow.topics.map(t => t.name), topicBoardIds: finalRow.topics.map(t => t.id), cooperation: { shareId: id, deliveryId: delivery.id } })
        local.bindings.push({ taskId, deliveryId: delivery.id, seen: finalRow.topics.map(t => t.id) }); local.delivered.push(delivery.id)
      }
      for (const binding of local.bindings) {
        const index = tasks.findIndex(t => t.id === binding.taskId)
        if (index >= 0) tasks[index] = appendSharedTopics(tasks[index], finalRow, binding.seen)
        binding.seen = [...new Set([...binding.seen, ...finalRow.topics.map(t => t.id)])]
      }
      if (!same(tasks, baselineTasks)) { await writeImportantTasks(root, tasks, baselineTasks); changed = true }
      local.incoming = remote; await writeJson(root, path, state)
      changed = await applyBoards(root, id, remote, local.baseline) || changed
      local.baseline = remote; local.incoming = undefined; await writeJson(root, path, state)
    }
    if (changed) window.dispatchEvent(new Event('cursado-cooperation-applied'))
  })
}
