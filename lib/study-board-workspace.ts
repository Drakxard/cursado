import { readWorkspaceJson, writeWorkspaceJson } from './workspace-json.ts'
import { withWorkspaceFileLock } from './workspace-file-lock.ts'
import { acceptMigrationTypes, type LegacyStudyBoard, type MigrationReport } from './study-board-migration.ts'

export type StudyBoardRecord = { version: 1; boardId: string; roomId: string; status: 'pending' | 'accepted' | 'cancelled'; draft?: string; report?: MigrationReport; imported?: boolean; localPdfReferences?: string[] }
const path = (id: string) => {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Identificador de pizarra inválido.')
  return `progreso/pizarra-sync/${id}.json`
}
const approvalsPath = 'progreso/pizarra-sync/migration-approvals.json'
async function cachedOriginal(boardId: string): Promise<LegacyStudyBoard | null> {
  if (typeof indexedDB === 'undefined') return null
  // Do not create or upgrade the old database just by opening a Study board.
  const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open('pizarra-dispositivo', 1)
    request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null) }
    request.onerror = () => request.error?.name === 'AbortError' ? resolve(null) : reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  if (!db) return null
  try {
    const get = (store: string, key: string) => new Promise<any>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const board = await get('boards', `local:important-${boardId}`)
    if (!board) return null
    const content = board.draft || board.content, assets: Record<string, string> = {}
    for (const media of content.media || []) {
      if (assets[media.assetId]) continue
      const blob = await get('assets', `device:${media.assetId}`) as Blob | undefined
      if (!blob) throw new Error('Falta un archivo de la pizarra anterior del dispositivo.')
      assets[media.assetId] = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob)
      })
    }
    return { version: 1, boardId, name: board.name, content, assets }
  } finally { db.close() }
}
export async function openStudyBoard(root: FileSystemDirectoryHandle, boardId: string, sharedRoomId?: string) {
  if (sharedRoomId && !/^study-[a-f0-9-]{36}$/.test(sharedRoomId)) throw new Error('Sala compartida inválida.')
  return withWorkspaceFileLock(`study-sync:${boardId}`, async () => {
    let record = await readWorkspaceJson<StudyBoardRecord | null>(root, path(boardId), null)
    if (!record) {
      record = { version: 1, boardId, roomId: sharedRoomId || `study-${crypto.randomUUID()}`, status: sharedRoomId ? 'accepted' : 'pending' }
      await writeWorkspaceJson(root, path(boardId), record)
    }
    if (record.version !== 1 || record.boardId !== boardId || !/^study-[a-f0-9-]{36}$/.test(record.roomId)) throw new Error('La asociación de la sala no es válida.')
    if(sharedRoomId) {
      if(record.roomId !== sharedRoomId) throw new Error('La sala compartida no coincide.')
      return {record,snapshot:null,approved:{}}
    }
    // A single immutable source makes simultaneous deterministic Yjs imports agree.
    // Completed boards need only their small room binding + Yjs checkpoint, not PDF/image originals.
    const originalPath = `progreso/pizarra-sync/${boardId}.original.json`
    let snapshot = record.imported ? null : await readWorkspaceJson<LegacyStudyBoard | null>(root, originalPath, null, true)
    if (!record.imported && !snapshot) {
      snapshot = await readWorkspaceJson<LegacyStudyBoard | null>(root, `progreso/pizarras/${boardId}.json`, null, true) ?? await cachedOriginal(boardId)
      if (snapshot && snapshot.version === 1 && snapshot.boardId === boardId && snapshot.content && ['strokes', 'texts', 'media'].every(key => Array.isArray(snapshot!.content[key])) && snapshot.assets) await writeWorkspaceJson(root, originalPath, snapshot)
    }
    if (snapshot && (snapshot.version !== 1 || snapshot.boardId !== boardId || !snapshot.content || !['strokes', 'texts', 'media'].every(key => Array.isArray(snapshot.content[key])) || !snapshot.assets)) throw new Error('El archivo anterior de la pizarra no es válido. Se conservó sin modificar.')
    if(record.localPdfReferences === undefined) {
      // Once for boards migrated before PDF publication existed. The frozen local
      // source authorizes these accesses; remote Yjs edits never authorize uploads.
      const source = snapshot ?? (record.imported ? await readWorkspaceJson<LegacyStudyBoard | null>(root,originalPath,null,true) : null)
      record = {...record,localPdfReferences:(source?.content.shapes || []).filter((shape:any)=>shape.visualType === 'pdf-shortcut' && shape.pdfReference).map((shape:any)=>JSON.stringify([shape.pdfReference.subjectId,shape.pdfReference.materialId,shape.pdfReference.workspaceFileId]))}
      await writeWorkspaceJson(root,path(boardId),record)
    }
    const approved = await readWorkspaceJson<Record<string, number>>(root, approvalsPath, {})
    return { record, snapshot, approved }
  })
}
export async function saveStudyBoard(root: FileSystemDirectoryHandle, boardId: string, update: Partial<Pick<StudyBoardRecord, 'draft' | 'report' | 'imported' | 'status' | 'localPdfReferences'>>) {
  return withWorkspaceFileLock(`study-sync:${boardId}`, async () => {
    const record = await readWorkspaceJson<StudyBoardRecord | null>(root, path(boardId), null)
    if (!record) throw new Error('Falta la asociación de esta pizarra.')
    // A second tab cannot undo an explicit acceptance with an older pending checkpoint.
    if (record.status === 'accepted' && update.status !== 'cancelled') delete update.status
    if(update.localPdfReferences) update.localPdfReferences = [...new Set([...(record.localPdfReferences || []),...update.localPdfReferences])]
    const next = { ...record, ...update }
    await writeWorkspaceJson(root, path(boardId), next)
    return next
  })
}
export async function confirmStudyMigration(root: FileSystemDirectoryHandle, boardId: string, report: MigrationReport) {
  await withWorkspaceFileLock('study-sync:approvals', async () => {
    const approved = await readWorkspaceJson<Record<string, number>>(root, approvalsPath, {})
    await writeWorkspaceJson(root, approvalsPath, acceptMigrationTypes(approved, report))
  })
  await saveStudyBoard(root, boardId, { status: 'accepted', report })
}
