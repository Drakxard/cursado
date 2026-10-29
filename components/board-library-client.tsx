'use client'

import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import type { AuthSession } from '@/lib/authz'
import ImportantProgressView from './important-progress-view'
import { SubjectWheelLoader } from './subject-wheel-loader'
import { EmbeddedWorkspaceProvider } from './local-workspace-provider'
import { PracticeViewerClient } from '@/app/practice/viewer/practice-viewer-client'
import { boardPdfReference, type BoardPdfReference } from '@/lib/board-library-contract'
import { getLocalMaterialById } from '@/lib/local-workspace-data'
import { getSubjectById } from '@/lib/subjects'
import { downloadStudyPdf } from '@/lib/study-board-pdf'
import { readFile } from '@/lib/client/cooperation-files'
import { setReadyWorkspaceHandle, loadWorkspaceHandle, queryWorkspacePermission, pickWorkspaceRootHandle, loadServicesFile, setReadyInscreenConfigToken, setReadyDriveConfigToken } from '@/lib/local-workspace-client'
import { isLocalStorageMode } from '@/lib/storage-mode'

export function BoardLibraryClient({authSession}:{authSession:AuthSession}) {
  const params = useSearchParams(), session = params.get('session'), boardId = params.get('boardId')
  const reader = params.get('mode') === 'reader'
  const calendar = params.get('mode') === 'calendar'
  const [providedRoot,setProvidedRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [initialized,setInitialized] = useState(false)
  const [reference,setReference] = useState<BoardPdfReference | null>(null)
  const [error,setError] = useState('')
  const [resolved,setResolved] = useState(false)
  const [material,setMaterial] = useState<ComponentProps<typeof PracticeViewerClient>['material']>()
  const [download,setDownload] = useState<number | null>(null)
  const viewerHost = useRef<HTMLDivElement>(null)
  const pendingReadingPosition = useRef<string | null>(null)
  const readerVisible = useRef(true)
  const forwardReaderVisibility = () => viewerHost.current?.querySelector('iframe')?.contentWindow?.postMessage(
    {type:'board-reader:visibility',visible:readerVisible.current},location.origin)
  const send = (type:string) => parent.postMessage({type,session,boardId},location.origin)
  useEffect(()=>{
    if(!session || !boardId || window.parent === window) {setError('Abrí la biblioteca desde una pizarra.');return}
    const receive = (event:MessageEvent) => {
      if(event.origin===location.origin && event.source===viewerHost.current?.querySelector('iframe')?.contentWindow) {
        if(event.data?.type==='board-reader:ready' || event.data?.type==='viewerReady') forwardReaderVisibility()
        if(event.data?.type==='viewerPageRendered') {
          forwardReaderVisibility()
          if(pendingReadingPosition.current) {
            event.source?.postMessage({type:'restoreViewerReadingPosition',hash:pendingReadingPosition.current}, {targetOrigin:location.origin})
            pendingReadingPosition.current=null
          }
          send('board-library:reader-rendered');return
        }
        if(event.data?.type==='viewerReadingPosition' && !pendingReadingPosition.current && typeof event.data.hash==='string' && event.data.hash.length<=512) {
          parent.postMessage({type:'board-library:reading-position',session,boardId,hash:event.data.hash},location.origin)
          return
        }
      }
      if(event.origin!==location.origin || event.source!==parent || event.data?.session!==session || event.data?.boardId!==boardId) return
      if(event.data.type==='board-library:init') {
        readerVisible.current=event.data.readerVisible!==false
        pendingReadingPosition.current=typeof event.data.readingPosition==='string' ? event.data.readingPosition : null
        if(event.data.rootHandle?.kind==='directory') {setReadyWorkspaceHandle(event.data.rootHandle);setProvidedRoot(event.data.rootHandle)}
        setReference(boardPdfReference(event.data.reference));setInitialized(true)
      }
      if(event.data.type==='board-library:reader-visibility' && typeof event.data.visible==='boolean') {
        readerVisible.current=event.data.visible
        forwardReaderVisibility()
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
      event.preventDefault();send(calendar?'board-library:calendar-closed':'board-library:escape')
    }
    window.addEventListener('message',receive)
    window.addEventListener('keydown',escape)
    send('board-library:ready')
    return ()=>{window.removeEventListener('message',receive);window.removeEventListener('keydown',escape)}
  },[session,boardId,reader,calendar])
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
    const controller = new AbortController()
    setResolved(false)
    void (async()=>{
      if(isLocalStorageMode()) {
        setReadyWorkspaceHandle(root!)
        const material = await getLocalMaterialById(reference.materialId, reference.subjectId)
        if(!material || material.subject_id!==reference.subjectId || material.drive_file_id!==reference.workspaceFileId || !material.drive_file_id || !await readFile(root!,material.drive_file_id.slice(12))) {
          const workspaceFileId = await downloadStudyPdf(root!,reference,value=>{if(current)setDownload(value)},controller.signal)
          if(current) setMaterial({id:parseInt(reference.sharedPdf!.hash.slice(0,12),16) || 1,subjectId:`shared-board:${reference.sharedPdf!.roomId}`,subjectName:'Pizarras compartidas',sessionDate:'',weekNumber:1,weekdayIndex:0,materialType:'theory',fileName:reference.fileName,workspaceFileId,sourceRevision:reference.sharedPdf!.hash})
        } else if(current) setMaterial({
          id: material.id, subjectId: material.subject_id,
          subjectName: getSubjectById(material.subject_id)?.name.replace('\n', ' ') || material.subject_id,
          sessionDate: material.session_date, weekNumber: material.week_number, weekdayIndex: material.weekday_index,
          materialType: material.material_type, fileName: material.file_name, workspaceFileId: material.drive_file_id,
          sourceRevision: `${material.drive_file_id}:${material.updated_at}`,
        })
      }
      if(current) setResolved(true)
    })().catch(error=>{if(current)setError(error.message)})
    return ()=>{current=false;controller.abort()}
  },[reader,initialized,reference,root])
  if(error) return <main style={{padding:24}}><p role="alert">{error}</p>{isLocalStorageMode()&&!root&&<button onClick={()=>{
    void pickWorkspaceRootHandle().then(handle=>{setReadyWorkspaceHandle(handle);setProvidedRoot(handle);setError('')}).catch(error=>setError(error.message))
  }}>Conectar carpeta</button>}{reader&&<button onClick={()=>send('board-library:reader-closed')}>Volver a la pizarra</button>}</main>
  if(!initialized || (isLocalStorageMode() && !root)) return reader ? <main aria-busy="true" aria-label="Abriendo PDF" /> : <p role="status">Conectando la biblioteca…</p>
  const content = calendar ? <ImportantProgressView active onBack={()=>send('board-library:calendar-closed')} initialCalendarTaskId={params.get('taskId')??undefined} /> : reader ? <div ref={viewerHost} style={{height:'100dvh'}}>{resolved && reference
    ? <PracticeViewerClient material={material} materialId={reference.materialId} mode="inline" boardReader onRequestClose={()=>send('board-library:reader-closed')} />
    : download !== null ? <div role="status" style={{padding:24}}><p>Descargando {reference?.fileName}: {download}%</p><progress value={download} max={100} style={{width:'min(360px, 100%)'}} /></div> : <div aria-busy="true" aria-label="Abriendo PDF" />}</div>
    : <SubjectWheelLoader authSession={authSession} boardLibrary />
  return root ? <EmbeddedWorkspaceProvider rootHandle={root}>{content}</EmbeddedWorkspaceProvider> : content
}
