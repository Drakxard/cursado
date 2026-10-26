import { workspaceRoot } from './canvas/countdowns'
import { deviceDB, writeDeviceBoard } from './storage/device'
import type { DeviceBoard } from './storage/device'
import { createWorkspaceBoardStore, isHomeBoard } from './storage/workspaceBoards'
import type { WorkspaceBoard } from './storage/workspaceBoards'
import { linkedAsset, portableBoardLinkBinding, restoreBoardLinkBinding } from './linkSharing'

const markerKey = (id: string) => `workspace-board:${id}`
const opened = new Map<string, { root: FileSystemDirectoryHandle; doc: WorkspaceBoard }>()
export async function homeBoardStore(id?: string) {
  if (id && !isHomeBoard(id)) return null
  const root = await workspaceRoot()
  const previous = id ? await (await deviceDB).get('meta', markerKey(id)) as FileSystemDirectoryHandle | undefined : undefined
  if (previous && (!root || !await previous.isSameEntry(root))) throw new Error('Conectá la carpeta original de Estudio para recuperar esta pizarra. La copia del navegador se conserva.')
  return root ? { root, store: createWorkspaceBoardStore(root) } : null
}
async function remember(root: FileSystemDirectoryHandle, doc: WorkspaceBoard, cached?: DeviceBoard) {
  const board: DeviceBoard = { ...cached, id: doc.id, key: doc.id, name: doc.name, folder_id: doc.folderId, storage: 'private', workspace: true,
    version: cached?.version ?? 0, updated_at: new Date().toISOString(), content: doc.scene }
  await writeDeviceBoard(board)
  await (await deviceDB).put('meta', root, markerKey(doc.id))
  opened.set(doc.id, { root, doc: structuredClone(doc) })
  await restoreBoardLinkBinding(doc.id, doc.sharedBoard)
  return board
}
export async function loadHomeWorkspaceBoard(id: string, cached?: DeviceBoard) {
  const target = await homeBoardStore(id)
  if (!target) return undefined
  let doc = await target.store.read(id)
  if (!doc) {
    const db = await deviceDB
    if (await db.get('meta', markerKey(id)) || (await target.store.index()).deleted?.includes(id)) throw new Error('La pizarra ya no está en la carpeta. No se reemplazó por la copia antigua del navegador.')
    if (!cached) return undefined
    if (cached.folder_id) {
      const folder = await db.get('folders', cached.folder_id)
      if (folder) await target.store.addFolder(folder)
    }
    doc = await target.store.save({ id, name: cached.name, folderId: cached.folder_id, scene: cached.draft ?? cached.content, assets: {}, sharedBoard: await portableBoardLinkBinding(id) },
      async assetId => await db.get('assets', `device:${assetId}`) ?? await linkedAsset(id,assetId))
  }
  return remember(target.root, doc, cached)
}
export async function saveHomeWorkspaceBoard(board: DeviceBoard) {
  const target = await homeBoardStore(board.id)
  if (!target) return undefined
  const previous = opened.get(board.id)
  // A board created or restored without opening has no folder baseline yet.
  if (!previous) await loadHomeWorkspaceBoard(board.id, board)
  const base = opened.get(board.id)!.doc.scene
  const doc = await target.store.save({ id: board.id, name: board.name, folderId: board.folder_id, scene: board.content, assets: {}, sharedBoard: await portableBoardLinkBinding(board.id) }, async id => {
    const local = await (await deviceDB).get('assets', `device:${id}`) as Blob | undefined
    return local ?? await loadHomeWorkspaceAsset(board.id, id)
  }, base)
  await remember(target.root, doc, board)
  window.dispatchEvent(new Event('cursado-workspace-saved'))
  return doc.scene
}
export async function loadHomeWorkspaceAsset(boardId: string, id: string): Promise<Blob | undefined> {
  if (!isHomeBoard(boardId)) return undefined
  const current = opened.get(boardId)
  if (!current?.doc.assets[id]) return undefined
  const target = await homeBoardStore(boardId)
  if (!target) return undefined
  const file = await target.store.asset(current.doc.assets[id])
  return new Blob([file], { type: current.doc.assetTypes?.[id] || file.type })
}
