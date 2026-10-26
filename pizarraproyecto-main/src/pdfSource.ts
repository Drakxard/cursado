import { boardPdfReference } from '../../lib/board-library-contract'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { workspaceRoot } from './canvas/countdowns'
import { isLinkGuest, sharedPdfUrl } from './linkSharing'

export async function readShortcutPdf(boardId: string, reference: BoardPdfReference, signal: AbortSignal): Promise<Blob> {
  if (!boardPdfReference(reference)) throw new Error('El acceso al PDF no es válido.')
  signal.throwIfAborted()
  let blob: Blob
  if (isLinkGuest()) {
    const response = await fetch(await sharedPdfUrl(boardId, reference), { credentials: 'include', signal })
    if (!response.ok) throw new Error('No se pudo abrir el PDF compartido.')
    blob = await response.blob()
  } else if (reference.workspaceFileId) {
    let root = await workspaceRoot()
    if (!root) throw new Error('Conectá la carpeta de Estudio para cargar este PDF.')
    const parts = reference.workspaceFileId.slice('workspace://'.length).split('/')
    for (const part of parts.slice(0, -1)) { signal.throwIfAborted(); root = await root.getDirectoryHandle(part) }
    blob = await (await root.getFileHandle(parts.at(-1)!)).getFile()
  } else {
    const response = await fetch(`/api/subject-day-materials/${reference.materialId}/file`, { credentials: 'include', signal })
    if (!response.ok) throw new Error('No se pudo cargar el PDF de este acceso.')
    blob = await response.blob()
  }
  signal.throwIfAborted()
  return blob.slice(0, blob.size, 'application/pdf')
}
