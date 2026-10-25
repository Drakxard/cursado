import { openDB } from 'idb'
import type { BoardContentWithExtras, BoardInfo, Folder } from '../biblioteca'

export type DeviceBoard = BoardInfo & {
  key: string
  content: BoardContentWithExtras
  draft?: BoardContentWithExtras
  draftBase?: {version:number;content:BoardContentWithExtras}
}
export const deviceDB = openDB('pizarra-dispositivo', 1, {
  upgrade(db) {
    db.createObjectStore('boards', { keyPath: 'key' })
    db.createObjectStore('folders', { keyPath: 'id' })
    db.createObjectStore('assets')
    db.createObjectStore('meta')
    db.createObjectStore('history', { keyPath: 'id' })
  },
})
export const isPrivate = (id: string) => id.startsWith('local:')
export const newLocalId = () => `local:${crypto.randomUUID()}`
export const emptyContent = (): BoardContentWithExtras => ({
  strokes: [], texts: [], media: [], camera: { x: 0, y: 0, zoom: 1 }, shapes: [], tables: [], graphs: [],
})
export async function readDeviceBoard(key: string): Promise<DeviceBoard | undefined> {
  return (await deviceDB).get('boards', key)
}
export async function writeDeviceBoard(board: DeviceBoard) {
  await (await deviceDB).put('boards', board)
  const channel = new BroadcastChannel('cursado-library-changes')
  channel.postMessage('saved'); channel.close()
}
export async function localLibrary() {
  const db = await deviceDB
  const boards: BoardInfo[] = []
  const tx = db.transaction('boards')
  // Project one record at a time. Never retain scenes or synchronization bases
  // just to display the library, including future fields added to DeviceBoard.
  for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
    const board = cursor.value
    if (!isPrivate(board.id) || board.id.startsWith('local:link-')) continue
    const { id, name, folder_id, version, updated_at, storage, role } = board
    boards.push({ id, name, folder_id, version, updated_at, storage, role })
  }
  await tx.done
  return {
    boards,
    folders: await db.getAll('folders') as Folder[],
  }
}
export async function migrateLegacy() {
  const db = await deviceDB
  if (await db.get('meta', 'legacy-migrated')) return
  const legacy = await openDB('mi-pizarra-db', 3, {
    upgrade(old) {
      if (!old.objectStoreNames.contains('boards')) old.createObjectStore('boards')
      if (!old.objectStoreNames.contains('assets')) old.createObjectStore('assets')
    },
  })
  try {
    const content = await legacy.get('boards', 'principal')
    if (content && !await db.get('boards', 'local:legacy')) {
      for (const id of await legacy.getAllKeys('assets')) {
        await db.put('assets', await legacy.get('assets', id), `device:${String(id)}`)
      }
      await writeDeviceBoard({ key: 'local:legacy', id: 'local:legacy', name: 'Pizarra local recuperada',
        folder_id: null, version: 0, updated_at: new Date().toISOString(), storage: 'private',
        content: { ...emptyContent(), ...content } })
    }
    await db.put('meta', true, 'legacy-migrated')
  } finally { legacy.close() }
}
