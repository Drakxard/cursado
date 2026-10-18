export const BOARD_PDF_MIME = 'application/x-cursado-board-pdf'
export type BoardPdfReference = {
  materialId: number
  subjectId: string
  fileName: string
  workspaceFileId: string | null
}
export function boardPdfReference(value: unknown): BoardPdfReference | null {
  if (!value || typeof value !== 'object') return null
  const v = value as BoardPdfReference
  if (!Number.isSafeInteger(v.materialId) || v.materialId < 1 ||
    typeof v.subjectId !== 'string' || !v.subjectId || v.subjectId.length > 200 ||
    typeof v.fileName !== 'string' || v.fileName.length > 500 || !/\.pdf$/i.test(v.fileName) ||
    !(v.workspaceFileId === null || (typeof v.workspaceFileId === 'string' &&
      v.workspaceFileId.startsWith('workspace://') && v.workspaceFileId.length <= 2000 &&
      !/[\\\x00-\x1f]/.test(v.workspaceFileId) && !v.workspaceFileId.slice(12).split('/').some(p=>!p || p==='.' || p==='..')))) return null
  return { materialId:v.materialId, subjectId:v.subjectId, fileName:v.fileName, workspaceFileId:v.workspaceFileId }
}
export function parseBoardPdfDrag(value: string): BoardPdfReference | null {
  try { return boardPdfReference(JSON.parse(value)) } catch { return null }
}
