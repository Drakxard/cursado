'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { AuthSession } from '@/lib/authz'
import { SubjectWheelLoader } from './subject-wheel-loader'
import { EmbeddedWorkspaceProvider } from './local-workspace-provider'
import { PracticeViewerClient } from '@/app/practice/viewer/practice-viewer-client'
import { boardPdfReference, type BoardPdfReference } from '@/lib/board-library-contract'
import { getLocalMaterialById } from '@/lib/local-workspace-data'
import { setReadyWorkspaceHandle, loadWorkspaceHandle, queryWorkspacePermission, pickWorkspaceRootHandle, loadServicesFile, setReadyInscreenConfigToken, setReadyDriveConfigToken } from '@/lib/local-workspace-client'
import { isLocalStorageMode } from '@/lib/storage-mode'

export function BoardLibraryClient({authSession}:{authSession:AuthSession}) {
  const params = useSearchParams(), session = params.get('session'), boardId = params.get('boardId')
  const reader = params.get('mode') === 'reader'
  const [providedRoot,setProvidedRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [initialized,setInitialized] = useState(false)
  const [reference,setReference] = useState<BoardPdfReference | null>(null)
  const [error,setError] = useState('')
  const [resolved,setResolved] = useState(false)
  const viewerHost = useRef<HTMLDivElement>(null)
  const send = (type:string) => parent.postMessage({type,session,boardId},location.origin)
  useEffect(()=>{
    if(!session || !boardId || window.parent === window) {setError('Abrí la biblioteca desde una pizarra.');return}
    const receive = (event:MessageEvent) => {
      if(event.origin===location.origin && event.source===viewerHost.current?.querySelector('iframe')?.contentWindow && event.data?.type==='viewerPageRendered') {send('board-library:reader-rendered');return}
      if(event.origin!==location.origin || event.source!==parent || event.data?.session!==session || event.data?.boardId!==boardId) return
      if(event.data.type==='board-library:init') {
        if(event.data.rootHandle?.kind==='directory') {setReadyWorkspaceHandle(event.data.rootHandle);setProvidedRoot(event.data.rootHandle)}
        setReference(boardPdfReference(event.data.reference));setInitialized(true)
      }
      if(event.data.type==='board-library:escape-reader') {
        const frame = viewerHost.current?.querySelector('iframe')
        if(frame) frame.contentWindow?.postMessage({type:'requestViewerEscape'},location.origin)
        else send('board-library:reader-closed')
      }
    }
    const escape = (event:KeyboardEvent) => {
      if(reader && event.key==='<' && !event.defaultPrevented && !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target as Element)?.closest('input,textarea,select,[contenteditable],[role="textbox"]')) {
        event.preventDefault();send('board-library:reader-closed');return
      }
      if(event.key!=='Escape' || event.defaultPrevented || event.repeat) return
      if(reader) {if(!viewerHost.current?.querySelector('iframe')){event.preventDefault();send('board-library:reader-closed')}return}
      if((event.target as Element)?.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('[role=dialog],[role=alertdialog]')) return
      event.preventDefault();send('board-library:escape')
    }
    window.addEventListener('message',receive)
    window.addEventListener('keydown',escape)
    send('board-library:ready')
    return ()=>{window.removeEventListener('message',receive);window.removeEventListener('keydown',escape)}
  },[session,boardId,reader])
  const root = providedRoot
  useEffect(()=>{
    if(!initialized || !isLocalStorageMode() || providedRoot)return
    let current = true
    void loadWorkspaceHandle().then(async handle=>{
      if(!handle || await queryWorkspacePermission(handle)!=='granted') throw new Error('Conectá la carpeta de Estudio para consultar sus PDF.')
      if(current){setReadyWorkspaceHandle(handle);setProvidedRoot(handle)}
    }).catch(error=>{if(current)setError(error.message)})
    return ()=>{current=false}
  },[initialized,providedRoot])
  useEffect(()=>{
    if(!root)return
    void loadServicesFile(root).then(services=>{
      if(services){setReadyInscreenConfigToken(services.inscreenToken);setReadyDriveConfigToken(services.driveToken)}
    }).catch(()=>{})
  },[root])
  useEffect(()=>{
    if(!reader || !initialized || !reference || (isLocalStorageMode() && !root)) return
    let current = true
    setResolved(false)
    void (async()=>{
      if(isLocalStorageMode()) {
        setReadyWorkspaceHandle(root!)
        const material = await getLocalMaterialById(reference.materialId)
        if(!material || material.subject_id!==reference.subjectId || material.drive_file_id!==reference.workspaceFileId)
          throw new Error('El material no está en esta carpeta. Conectá la carpeta original o recuperá el archivo.')
      }
      if(current) setResolved(true)
    })().catch(error=>{if(current)setError(error.message)})
    return ()=>{current=false}
  },[reader,initialized,reference,root])
  if(error) return <main style={{padding:24}}><p role="alert">{error}</p>{isLocalStorageMode()&&!root&&<button onClick={()=>{
    void pickWorkspaceRootHandle().then(handle=>{setReadyWorkspaceHandle(handle);setProvidedRoot(handle);setError('')}).catch(error=>setError(error.message))
  }}>Conectar carpeta</button>}{reader&&<button onClick={()=>send('board-library:reader-closed')}>Volver a la pizarra</button>}</main>
  if(!initialized || (isLocalStorageMode() && !root)) return <p role="status">Conectando la biblioteca…</p>
  const content = reader ? <div ref={viewerHost} style={{height:'100dvh'}}>{resolved && reference
    ? <PracticeViewerClient materialId={reference.materialId} mode="inline" boardReader onRequestClose={()=>send('board-library:reader-closed')} />
    : <p role="status">Buscando el PDF…</p>}</div>
    : <SubjectWheelLoader authSession={authSession} boardLibrary />
  return root ? <EmbeddedWorkspaceProvider rootHandle={root}>{content}</EmbeddedWorkspaceProvider> : content
}
