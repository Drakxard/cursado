import { getActiveBoardId, selectBoard, setStorageSession } from './biblioteca'
import type { BoardContentWithExtras } from './biblioteca'
import { deviceDB, emptyContent, readDeviceBoard, writeDeviceBoard } from './storage/device'
import { nativeBoardMode } from './nativeWorkspace'

type TopicWorkspace = { boardId: string; name: string; rootHandle: FileSystemDirectoryHandle }
type TopicSnapshot = { version: 1; boardId: string; name: string; content: BoardContentWithExtras; assets: Record<string, string> }
let workspace: TopicWorkspace | null = null
export const getTopicWorkspaceRoot = () => workspace?.rootHandle ?? null
export const isTopicWorkspace = () => workspace !== null || (nativeBoardMode() && new URLSearchParams(location.search).has('topicBoard'))
export function notifyTopicWorkspace(type: 'ready' | 'closed' | 'error', error?: string) {
  if (workspace) parent.postMessage({ type: `topic-board:${type}`, boardId: workspace.boardId, error }, location.origin)
}
async function boardDirectory(root: FileSystemDirectoryHandle) {
  const progress = await root.getDirectoryHandle('progreso', { create: true })
  return progress.getDirectoryHandle('pizarras', { create: true })
}
export async function initializeTopicWorkspace(input: TopicWorkspace) {
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
  workspace = input
  setStorageSession(null, false)
  selectBoard(id, false)
  await saveTopicWorkspace()
}

export async function saveTopicWorkspace() {
  if (!workspace) return
  if (getActiveBoardId() !== `local:important-${workspace.boardId}`) throw new Error('La pizarra activa no corresponde al tema.')
  const board = await readDeviceBoard(getActiveBoardId())
  if (!board) throw new Error('No se encontró la pizarra del tema.')
  const content = board.content
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
  const directory = await boardDirectory(workspace.rootHandle)
  const file = await directory.getFileHandle(`${workspace.boardId}.json`, { create: true })
  const writer = await file.createWritable()
  await writer.write(JSON.stringify({ version: 1, boardId: workspace.boardId, name: workspace.name, content, assets } satisfies TopicSnapshot))
  await writer.close()
}
