import { nativeSnapshot, readOnlyError } from '../../lib/native-workspace'
import type { BoardContentWithExtras, BoardInfo, Folder } from './biblioteca'

type BoardDocument = { id: string; name: string; folderId: string | null; scene: BoardContentWithExtras; assets: Record<string,string> }
const documents = new Map<string, { path: string; name: string; id: string; folderId: string | null }>()
let current: BoardDocument | undefined
let folders: Folder[] = []
export const nativeBoardMode = () => typeof window !== 'undefined' && Boolean(window.CursadoNative)
async function read(path: string) {
  const manifest = nativeSnapshot().manifest!
  const file = manifest.files.find(file => file.path === path)
  if (!file) throw new Error('No se encontró el recurso de esta pizarra.')
  const response = await fetch(`/files/${manifest.revision}/${file.id}`)
  if (!response.ok) throw new Error('Pizarra pendiente de descarga. Conectate y reintentá.')
  return response
}
export async function prepareNativeBoards() {
  const manifest = nativeSnapshot().manifest
  if (!manifest) throw new Error('La biblioteca todavía no está descargada.')
  const topic = new URLSearchParams(location.search).get('topicBoard')
  if (topic) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(topic)) throw new Error('Tema inválido.')
    const snapshot = await (await read(`progreso/pizarras/${topic}.json`)).json()
    current = {id:`local:important-${topic}`,name:snapshot.name,folderId:null,scene:snapshot.content,assets:snapshot.assets}
    documents.set(current.id,{id:current.id,name:current.name,path:`progreso/pizarras/${topic}.json`,folderId:null})
    return
  }
  const index = manifest.files.find(file => file.path === 'boards/library.json')
  if (index) {
    const library = await (await read(index.path)).json() as { folders: Folder[]; boards: {id: string; name: string; path: string; folderId: string | null}[] }
    folders = library.folders
    for (const board of library.boards) documents.set(board.id, board)
  } else {
    // Existing installations can open old inventories before the PC republishes.
    for (const item of manifest.items.filter(item => item.kind === 'board' && item.fileId)) {
      const file = manifest.files.find(file => file.id === item.fileId)!
      const id = `local:legacy-${file.id}`
      documents.set(id, { id, name: item.title, path: file.path, folderId: null })
    }
  }
}
export function nativeBoardLibrary(): { folders: Folder[]; boards: BoardInfo[] } {
  return { folders, boards: [...documents.values()].map(board => ({id:board.id,name:board.name,folder_id:board.folderId,version:0,updated_at:nativeSnapshot().manifest!.publishedAt,storage:'private'})) }
}
export async function loadNativeBoard(id: string) {
  const board = documents.get(id)
  if (!board) throw new Error('Esta biblioteca no tiene pizarras disponibles.')
  if (!board.path.startsWith('progreso/')) current = await (await read(board.path)).json()
  return current!.scene
}
export async function loadNativeAsset(id: string) {
  const path = current?.assets[id]; if (!path) throw new Error('Falta una imagen de la pizarra.')
  if (path.startsWith('data:')) { const match=/^data:([^;,]+);base64,(.*)$/.exec(path); if (!match) throw new Error('Imagen inválida.'); return new Blob([Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0))],{type:match[1]}) }
  return (await read(path)).blob()
}
export function nativeAssetCacheKey(id: string) { return `native:${nativeSnapshot().manifest?.revision}:${current?.id}:${id}` }
export { readOnlyError }
