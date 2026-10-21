import type { ShapeItem } from './canvas/visualObjects'
import { boardPdfReference, type BoardPdfReference } from '../../lib/board-library-contract'
import { getActiveBoardId, selectBoard, setStorageSession } from './biblioteca'
import type { BoardContentWithExtras } from './biblioteca'
import { deviceDB, emptyContent, readDeviceBoard, writeDeviceBoard } from './storage/device'
import { nativeBoardMode } from './nativeWorkspace'
import { mergeCooperation, type Json } from '../../lib/cooperation-model'

type TopicWorkspace = { cooperationWeekNumber?: number; cooperationSubjectId?: string; pdfReferences?: BoardPdfReference[]; boardId: string; name: string; rootHandle: FileSystemDirectoryHandle }
type TopicSnapshot = { version: 1; boardId: string; name: string; content: BoardContentWithExtras; assets: Record<string, string> }
let navigationRoot:FileSystemDirectoryHandle|null=null
let workspace: TopicWorkspace | null = null
let presented: BoardContentWithExtras | null = null
let saved: BoardContentWithExtras | null = null
export const getTopicWorkspaceRoot = () => workspace?.rootHandle ?? navigationRoot
export function sendTopicLive(payload: Record<string, unknown>) { if (!workspace?.cooperationSubjectId) return; parent.postMessage({ type: 'topic-board:ephemeral', boardId: workspace.boardId, payload }, location.origin) }
export const isTopicWorkspace = () => workspace !== null || (nativeBoardMode() && new URLSearchParams(location.search).has('topicBoard'))
export function notifyTopicWorkspace(type: 'ready' | 'closed' | 'error', error?: string) {
  if (workspace) parent.postMessage({ type: `topic-board:${type}`, boardId: workspace.boardId, error }, location.origin)
}
async function boardDirectory(root: FileSystemDirectoryHandle) {
  const progress = await root.getDirectoryHandle('progreso', { create: true })
  return progress.getDirectoryHandle('pizarras', { create: true })
}
export async function initializeTopicWorkspace(input: TopicWorkspace, preserveSession = false) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.boardId)) throw new Error('Identificador de tema inválido.')
  const directory = await boardDirectory(input.rootHandle)
  let snapshot: TopicSnapshot | null = null
  try {
    const file = await directory.getFileHandle(`${input.boardId}.json`)
    snapshot = JSON.parse(await (await file.getFile()).text()) as TopicSnapshot
    if (snapshot.version !== 1 || snapshot.boardId !== input.boardId || !snapshot.content ||
      !Array.isArray(snapshot.content.strokes) || !Array.isArray(snapshot.content.texts) || !Array.isArray(snapshot.content.media) ||
      !snapshot.assets || typeof snapshot.assets !== 'object') throw new Error('El archivo de la pizarra no tiene un formato válido.')
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
  const id = `local:important-${input.boardId}`
  const cached = await readDeviceBoard(id)
  const content = snapshot?.content ?? cached?.content ?? emptyContent()
  const shapes = (content.shapes ??= []) as ShapeItem[]
  const existing = new Set(shapes.filter(shape => shape.visualType === 'pdf-shortcut').map(shape => shape.pdfReference?.materialId))
  const references = Array.isArray(input.pdfReferences) ? input.pdfReferences.map(boardPdfReference).filter((item): item is BoardPdfReference => item !== null) : []
  const bottom = shapes.reduce((value, shape) => Math.max(value, shape.y + shape.height), 0)
  let added = 0
  for (const reference of references) {
    if (existing.has(reference.materialId)) continue
    shapes.push({ id: crypto.randomUUID(), kind: 'rounded', visualType: 'pdf-shortcut', pdfReference: reference,
      label: reference.fileName.replace(/\.pdf$/i, ''), x: 40, y: bottom + 40 + added++ * 74,
      width: 320, height: 54, color: '#2563eb', strokeWidth: 1.5 })
    existing.add(reference.materialId)
  }
  if (snapshot) {
    for (const media of content.media) {
      const data = snapshot.assets[media.assetId]
      if (!data || !/^data:[^,]*;base64,/.test(data)) throw new Error('Falta una imagen en el respaldo de la pizarra.')
      const comma = data.indexOf(',')
      const bytes = Uint8Array.from(atob(data.slice(comma + 1)), char => char.charCodeAt(0))
      await (await deviceDB).put('assets', new Blob([bytes], { type: data.slice(5, data.indexOf(';')) }), `device:${media.assetId}`)
    }
  }
  await writeDeviceBoard({ key: id, id, name: input.name, folder_id: null, version: cached?.version ?? 0,
    updated_at: new Date().toISOString(), storage: 'private', content })
  navigationRoot=input.rootHandle
  workspace = input
  presented = structuredClone(content)
  saved = presented
  if(!preserveSession)setStorageSession(null, false)
  selectBoard(id, false)
  await saveTopicWorkspace()
}

export async function saveTopicWorkspace() {
  if (!workspace) return
  if (getActiveBoardId() !== `local:important-${workspace.boardId}`) throw new Error('La pizarra activa no corresponde al tema.')
  const board = await readDeviceBoard(getActiveBoardId())
  if (!board) throw new Error('No se encontró la pizarra del tema.')
  let content = board.content
  const directory = await boardDirectory(workspace.rootHandle)
  try {
    const latest = JSON.parse(await (await (await directory.getFileHandle(`${workspace.boardId}.json`)).getFile()).text()) as TopicSnapshot
    const camera = content.camera
    content = mergeCooperation(saved as unknown as Json, content as unknown as Json, latest.content as unknown as Json) as unknown as BoardContentWithExtras
    content.camera = camera
  } catch (error) { if ((error as Error).name !== 'NotFoundError') throw error }
  const assets: Record<string, string> = {}
  for (const media of content.media) {
    const blob = await (await deviceDB).get('assets', `device:${media.assetId}`) as Blob | undefined
    if (!blob) throw new Error('Falta una imagen de la pizarra.')
    assets[media.assetId] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  }
  const file = await directory.getFileHandle(`${workspace.boardId}.json`, { create: true })
  const writer = await file.createWritable()
  await writer.write(JSON.stringify({ version: 1, boardId: workspace.boardId, name: workspace.name, content, assets, cooperationWeekNumber: workspace.cooperationWeekNumber, cooperationSubjectId: workspace.cooperationSubjectId }))
  await writer.close()
  saved = structuredClone(content)
  // Recognize saved local edits without consuming remote changes before display.
  // Baselines are immutable: share their checkpoint when no remote merge occurred.
  presented = content === board.content ? saved : structuredClone(board.content)
  parent.postMessage({ type: 'topic-board:saved', boardId: workspace.boardId }, location.origin)
}

export async function receiveTopicWorkspace(local: BoardContentWithExtras, isCurrent = () => true): Promise<BoardContentWithExtras | null> {
  if (!workspace) return null
  const directory = await boardDirectory(workspace.rootHandle)
  const snapshot = JSON.parse(await (await (await directory.getFileHandle(`${workspace.boardId}.json`)).getFile()).text()) as TopicSnapshot
  if (!snapshot.content || snapshot.boardId !== workspace.boardId) throw new Error('Pizarra recibida inválida.')
  const merged = mergeCooperation(presented as unknown as Json, local as unknown as Json, snapshot.content as unknown as Json) as unknown as BoardContentWithExtras
  merged.camera = local.camera
  for (const media of merged.media || []) {
    const data = snapshot.assets[media.assetId]
    if (!data || !/^data:[^,]*;base64,/.test(data)) continue
    const comma = data.indexOf(',')
    const bytes = Uint8Array.from(atob(data.slice(comma + 1)), c => c.charCodeAt(0))
    await (await deviceDB).put('assets', new Blob([bytes], { type: data.slice(5, data.indexOf(';')) }), `device:${media.assetId}`)
  }
  if (!isCurrent()) return null
  presented = structuredClone(merged)
  saved = merged === snapshot.content ? presented : structuredClone(snapshot.content)
  return merged
}

export function topicNavigationContext(){return {workspace,presented,saved}}
export function restoreTopicNavigationContext(context:ReturnType<typeof topicNavigationContext>){workspace=context.workspace;presented=context.presented;saved=context.saved}
export function suspendTopicNavigation(){workspace=null;presented=null;saved=null}
