import { digest, readFile, readJson, writeFile, writeJson, mapBindingText } from './client/cooperation-files.ts'
import { cooperationState } from './client/cooperation.ts'
import { withWorkspaceFileLock } from './workspace-file-lock.ts'
import type { BoardPdfReference } from './board-library-contract.ts'
import { createUploadQueue } from '../pizarra-sync/packages/client-web/src/upload-queue.ts'

export const STUDY_PDF_WORKER = 'https://pizarra-komuboard.dariorafael2005.workers.dev'
export const sharedPdfPath = (hash: string) => `pizarrasCompartidas/${hash}.pdf`
const endpoint = (roomId: string, hash: string) => `${STUDY_PDF_WORKER}/study-pdf/${roomId}/${hash}`
const upload = createUploadQueue()

export async function publishStudyPdf(root: FileSystemDirectoryHandle, roomId: string, reference: BoardPdfReference) {
  if(reference.sharedPdf?.roomId === roomId) return reference.sharedPdf
  if(!reference.workspaceFileId) return null
  const file = await readFile(root,reference.workspaceFileId.slice(12))
  if(!file) return null // Another participant's local reference is not a local upload.
  if(file.size > 100*1024*1024) throw new Error(`${reference.fileName}: el PDF supera 100 MB.`)
  const hash = await digest(file), sharedPdf = {roomId,hash,size:file.size}
  if((await fetch(endpoint(roomId,hash),{method:'HEAD'})).ok) return sharedPdf
  // Cooperative sphere blobs already live in R2. Reuse them after the existing
  // service validates membership; only a room-scoped pointer is created.
  for(const mirror of Object.values(cooperationState().mirrors)) {
    const resource = Object.values({...mirror.baseline.resources,...mirror.incoming?.resources}).find(resource => !resource.deleted && resource.blob?.hash === hash && mapBindingText(resource.key,mirror.binding,true) === reference.workspaceFileId!.slice(12))
    if(!resource) continue
    const reused = await fetch('/pizarra/study-pdf/reuse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId,hash,sphereId:mirror.binding.id})})
    if(reused.ok) return sharedPdf
  }
  const response = await upload(endpoint(roomId,hash),{method:'POST',headers:{'Content-Type':'application/pdf','X-File-Size':String(file.size)},body:file})
  if(!response.ok) throw new Error(`${reference.fileName}: no se pudo publicar el PDF (HTTP ${response.status}).`)
  return sharedPdf
}

export async function downloadStudyPdf(root: FileSystemDirectoryHandle, reference: BoardPdfReference, progress: (percent:number)=>void, signal?: AbortSignal) {
  const shared = reference.sharedPdf
  if(!shared) throw new Error('Quien agregó este acceso debe abrir la pizarra para publicar el PDF.')
  const {hash,roomId,size} = shared, path = sharedPdfPath(hash)
  return withWorkspaceFileLock(`study-pdf:${hash}`,async()=>{
    const marker = await readJson<{complete?:boolean}>(root,`pizarrasCompartidas/${hash}.json`,{})
    // PDF.js may have saved local annotations. Do not replace an already completed copy.
    if(marker.complete && await readFile(root,path)) return `workspace://${path}`
    for(const mirror of Object.values(cooperationState().mirrors)) {
      const resource = Object.values({...mirror.baseline.resources,...mirror.incoming?.resources}).find(resource=>!resource.deleted && resource.blob?.hash === hash)
      if(!resource) continue
      const localPath = mapBindingText(resource.key,mirror.binding,true), local = await readFile(root,localPath)
      if(local && local.size === size && await digest(local) === hash) return `workspace://${localPath}`
    }
    progress(0)
    const response = await fetch(endpoint(roomId,hash),{signal})
    if(!response.ok || !response.body) throw new Error(`No se pudo descargar el PDF (HTTP ${response.status}).`)
    const reader = response.body.getReader(), chunks:Uint8Array[] = []
    let received = 0
    try {
      while(true) {
        const next = await reader.read(); if(next.done) break
        received += next.value.length
        if(received > size) throw new Error('El tamaño del PDF compartido no coincide.')
        chunks.push(next.value); progress(Math.min(99,Math.floor(received / size * 100)))
      }
    } catch(error) { await reader.cancel().catch(()=>{}); throw error }
    const blob = new Blob(chunks as BlobPart[],{type:'application/pdf'})
    if(received !== size || await digest(blob) !== hash) throw new Error('La descarga quedó incompleta o el PDF cambió. Reintentá abrirlo.')
    signal?.throwIfAborted()
    await writeFile(root,path,blob)
    await writeJson(root,`pizarrasCompartidas/${hash}.json`,{complete:true,hash,size,fileName:reference.fileName})
    progress(100)
    return `workspace://${path}`
  })
}
