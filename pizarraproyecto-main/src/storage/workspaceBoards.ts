import type { BoardContentWithExtras, BoardInfo, Folder } from '../biblioteca'
import { validBoardContent } from '../../../lib/board-link-model'
import { withWorkspaceFileLock } from '../../../lib/workspace-file-lock'
import { mergeBoard, strokeIds } from './merge'

type Entry = { id: string; name: string; folderId: string | null; path: string }
type Index = { version: 1; folders: Folder[]; boards: Entry[]; deleted?: string[]; deletedFolders?: string[] }
export type WorkspaceBoard = {
  id: string; name: string; folderId: string | null; scene: BoardContentWithExtras
  assets: Record<string, string>; assetTypes?: Record<string, string>; revision?: number; sharedBoard?: unknown
}
const missing = (error: unknown) => (error as Error)?.name === 'NotFoundError'
async function fileText(file: FileSystemFileHandle): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try { return await (await file.getFile()).text() }
    catch (error) {
      // Chromium invalidates an acquired File snapshot when another writer
      // commits. Acquire it again rather than treating a normal save as damage.
      if ((error as Error).name !== 'NotReadableError' || attempt >= 3) throw error
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
}
const digest = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('')
export const isHomeBoard = (id: string) => id.startsWith('local:') && !id.startsWith('local:important-') && !id.startsWith('local:link-')

/** Uses the same flat boards/ documents understood by the native publisher. */
export function createWorkspaceBoardStore(root: FileSystemDirectoryHandle) {
  async function directory(create = false) { return root.getDirectoryHandle('boards', { create }) }
  async function readIndex(): Promise<Index> {
    try {
      const index = JSON.parse(await fileText(await (await directory()).getFileHandle('library.json'))) as Index
      if (index.version !== 1 || !Array.isArray(index.boards) || !Array.isArray(index.folders) ||
        index.boards.some(b => !b || !isHomeBoard(b.id) || typeof b.name !== 'string' || !/^boards\/[a-zA-Z0-9-]+\.json$/.test(b.path)) ||
        index.folders.some(f => !f || typeof f.id !== 'string' || typeof f.name !== 'string') ||
        (index.deleted !== undefined && (!Array.isArray(index.deleted) || index.deleted.some(id => typeof id !== 'string'))) ||
        (index.deletedFolders !== undefined && (!Array.isArray(index.deletedFolders) || index.deletedFolders.some(id => typeof id !== 'string')))) throw new Error('El índice de pizarras de la carpeta no es válido.')
      return index
    } catch (error) { if (missing(error)) return { version: 1, folders: [], boards: [] }; throw error }
  }
  async function write(name: string, blob: Blob | string) {
    const file = await (await directory(true)).getFileHandle(name, { create: true })
    const writer = await file.createWritable()
    try { await writer.write(blob); await writer.close() }
    catch (error) { await writer.abort().catch(() => {}); throw error }
  }
  async function indexChange(update: (index: Index) => void) {
    return withWorkspaceFileLock('boards/library.json', async () => {
      const index = await readIndex(); update(index)
      const text = JSON.stringify(index)
      await write('library.json', text)
      if (await fileText(await (await directory()).getFileHandle('library.json')) !== text) throw new Error('No se pudo verificar el índice de pizarras.')
    })
  }
  async function read(id: string): Promise<WorkspaceBoard | undefined> {
    const entry = (await readIndex()).boards.find(b => b.id === id)
    if (!entry) return undefined
    const doc = JSON.parse(await fileText(await (await directory()).getFileHandle(entry.path.slice(7)))) as WorkspaceBoard
    if (doc.id !== id || !validBoardContent(doc.scene) || !doc.assets || typeof doc.assets !== 'object' || Array.isArray(doc.assets)) throw new Error('El archivo de la pizarra no es válido.')
    return { ...doc, name: entry.name, folderId: entry.folderId }
  }
  async function asset(path: string) {
    if (!/^boards\/[a-zA-Z0-9-]+\.bin$/.test(path)) throw new Error('La ruta del recurso de la pizarra no es válida.')
    return (await (await directory()).getFileHandle(path.slice(7))).getFile()
  }
  return {
    read, asset, index: readIndex,
    async library() {
      const index = await readIndex()
      return { folders: index.folders, boards: index.boards.map((b): BoardInfo => ({ id: b.id, name: b.name, folder_id: b.folderId, version: 0, updated_at: '', storage: 'private', workspace: true })), deleted: index.deleted ?? [], deletedFolders: index.deletedFolders ?? [] }
    },
    async save(input: WorkspaceBoard, load: (id: string) => Promise<Blob | undefined>, base?: BoardContentWithExtras) {
      if (!isHomeBoard(input.id)) throw new Error('Esta pizarra usa otro almacenamiento.')
      return withWorkspaceFileLock(`boards/${input.id}`, async () => {
        const index = await readIndex()
        if (index.deleted?.includes(input.id)) throw new Error('La pizarra fue eliminada de la carpeta. Se conserva la copia del navegador.')
        const latest = await read(input.id)
        if (base && !latest) throw new Error('La pizarra ya no está en la carpeta. La copia del navegador se conserva.')
        // An existing folder document always wins during legacy migration.
        if (latest && !base) return latest
        const scene = latest && base ? mergeBoard(strokeIds(base), strokeIds(input.scene), strokeIds(latest.scene)) : strokeIds(input.scene)
        const assets: Record<string, string> = {}, assetTypes: Record<string, string> = {}
        for (const media of scene.media) {
          if (assets[media.assetId]) continue
          // Asset IDs are immutable. Reuse their files without reading or
          // hashing every original again on each text edit.
          if (latest?.assets[media.assetId]) {
            assets[media.assetId] = latest.assets[media.assetId]
            assetTypes[media.assetId] = latest.assetTypes?.[media.assetId] ?? ''
            continue
          }
          const blob = await load(media.assetId)
          if (blob) {
            const name = `${await digest(blob)}.bin`
            try { await asset(`boards/${name}`) } catch (error) { if (!missing(error)) throw error; await write(name, blob) }
            assets[media.assetId] = `boards/${name}`
            assetTypes[media.assetId] = blob.type
          } else throw new Error(`Falta el archivo «${media.name}». La copia del navegador se conserva.`)
        }
        const name = `${await digest(new Blob([input.id]))}.json`
        const folderId = latest ? latest.folderId : index.deletedFolders?.includes(input.folderId ?? '') ? null : input.folderId
        const doc: WorkspaceBoard = { ...input, name: latest?.name ?? input.name, folderId, scene, assets, assetTypes, revision: (latest?.revision ?? 0) + 1 }
        const text = JSON.stringify(doc)
        await write(name, text)
        if (await fileText(await (await directory()).getFileHandle(name)) !== text) throw new Error('No se pudo verificar la pizarra guardada.')
        await indexChange(index => {
          if (index.deleted?.includes(input.id)) throw new Error('La pizarra fue eliminada durante el guardado.')
          const previous = index.boards.find(b => b.id === input.id)
          if (!previous) index.boards.push({ id: input.id, name: doc.name, folderId: doc.folderId, path: `boards/${name}` })
        })
        return doc
      })
    },
    async rename(id: string, name: string, folderId: string | null) {
      await indexChange(index => { const entry = index.boards.find(b => b.id === id); if (!entry) throw new Error('Pizarra inexistente en la carpeta.'); entry.name = name; entry.folderId = folderId })
    },
    async remove(id: string) {
      await indexChange(index => { index.boards = index.boards.filter(b => b.id !== id); index.deleted = [...new Set([...(index.deleted ?? []), id])] })
    },
    async addFolder(folder: Folder) {
      await indexChange(index => { if (!index.deletedFolders?.includes(folder.id) && !index.folders.some(f => f.id === folder.id)) index.folders.push(folder) })
    },
    async removeFolder(id: string) {
      await indexChange(index => { index.folders = index.folders.filter(f => f.id !== id); index.deletedFolders = [...new Set([...(index.deletedFolders ?? []), id])]; for (const board of index.boards) if (board.folderId === id) board.folderId = null })
    },
  }
}
