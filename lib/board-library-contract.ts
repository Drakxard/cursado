export const BOARD_PDF_MIME = 'application/x-cursado-board-pdf'
export type BoardPdfReference = {
  materialId: number
  subjectId: string
  fileName: string
  workspaceFileId: string | null
  sharedFileId?: string
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
  if(v.sharedFileId!==undefined && !/^[a-zA-Z0-9_-]{1,200}$/.test(v.sharedFileId))return null
  return { materialId:v.materialId, subjectId:v.subjectId, fileName:v.fileName, workspaceFileId:v.workspaceFileId, ...(v.sharedFileId?{sharedFileId:v.sharedFileId}:{}) }
}
export function parseBoardPdfDrag(value: string): BoardPdfReference | null {
  try { return boardPdfReference(JSON.parse(value)) } catch { return null }
}

export const BOARD_IMPORTANT_MIME = 'application/x-cursado-important'
export const BOARD_LINK_MIME = 'application/x-cursado-board-link'
export function parseBoardLinkDrag(text:string):{boardId:string;name:string}|null {
  try { const value=JSON.parse(text);return typeof value.boardId==='string'&&value.boardId.length>0&&value.boardId.length<=200&&typeof value.name==='string'&&value.name.length<=500?{boardId:value.boardId,name:value.name}:null } catch{return null}
}
export function parseImportantDrag(text:string):{taskId:string}|null {
  try { const value=JSON.parse(text);return typeof value.taskId==='string'&&value.taskId.length>0&&value.taskId.length<=200?{taskId:value.taskId}:null } catch{return null}
}
