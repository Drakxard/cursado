import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { getTopicWorkspaceRoot } from './topicWorkspace'
import { isNativeReadOnly, openNativePdf } from '../../lib/native-workspace'

// Retain at most the last pinned reader during this board session.
export function useBoardLibrary(boardId: string, pinnedMaterialId?: number) {
  const native = isNativeReadOnly()
  const [nativeError, setNativeError] = useState('')
  const nativeRequest = useRef<AbortController | null>(null)
  const nativeReference = useRef<BoardPdfReference | null>(null)
  const [splitOpen,setSplitOpen] = useState(false)
  const [reader,setReader] = useState<BoardPdfReference | null>(null)
  const [retained,setRetained] = useState<BoardPdfReference | null>(null)
  const [calendarTask,setCalendarTask] = useState<string | null>(null)
  useEffect(()=>{
    if(retained&&retained.materialId!==pinnedMaterialId)setRetained(null)
  },[pinnedMaterialId,retained])
  const libraryFrame = useRef<HTMLIFrameElement>(null)
  const readerFrames = useRef(new Map<number, HTMLIFrameElement>())
  const readingPositions = useRef(new Map<number, string>())
  const [ready, setReady] = useState<Set<number>>(new Set())
  const session = useMemo(()=>crypto.randomUUID(),[boardId])
  const frames = useRef({reader,retained,boardId,session})
  frames.current = {reader,retained,boardId,session}
  useEffect(()=>{setSplitOpen(false);setReader(null);setRetained(null);setCalendarTask(null);readingPositions.current.clear();setReady(new Set())},[boardId])
  useEffect(() => {
    setNativeError('')
    return () => { nativeRequest.current?.abort(); nativeRequest.current = null }
  }, [boardId])
  useEffect(()=>{
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.session !== session || event.data?.boardId !== boardId) return
      const readerEntry = [...readerFrames.current].find(([, frame]) => event.source === frame.contentWindow)
      const isReader = Boolean(readerEntry)
      const isLibrary = event.source === libraryFrame.current?.contentWindow
      if (!isReader && !isLibrary) return
      if(event.data.type === 'board-library:ready') {
        const target = readerEntry ? readerEntry[1] : libraryFrame.current
        target?.contentWindow?.postMessage({type:'board-library:init',session,boardId,
          rootHandle:getTopicWorkspaceRoot(),reference:readerEntry ? frames.current.reader ?? frames.current.retained : null,
          readingPosition:readerEntry ? readingPositions.current.get(readerEntry[0]) : undefined},location.origin)
      }
      if(event.data.type === 'board-library:reading-position' && readerEntry && typeof event.data.hash === 'string' && event.data.hash.length <= 512) {
        readingPositions.current.set(readerEntry[0], event.data.hash)
        if(readingPositions.current.size > 50) readingPositions.current.delete(readingPositions.current.keys().next().value!)
      }
      if(event.data.type === 'board-library:reader-rendered' && readerEntry) setReady(previous => new Set([...previous, readerEntry[0]]))
      if(event.data.type === 'board-library:escape' && isLibrary && !frames.current.reader) {
        setSplitOpen(false)
        document.querySelector<HTMLCanvasElement>('.app canvas')?.focus()
      }
      if(event.data.type === 'board-library:calendar-closed' && isLibrary) {setCalendarTask(null);document.querySelector<HTMLCanvasElement>('.app canvas')?.focus()}
      if(event.data.type === 'board-library:reader-closed' && readerEntry && readerEntry[0]===frames.current.reader?.materialId) {
        setReader(null);if(!frames.current.retained)setReady(new Set())
        document.querySelector<HTMLCanvasElement>('.app canvas')?.focus()
      }
    }
    window.addEventListener('message',receive)
    return ()=>window.removeEventListener('message',receive)
  },[boardId,session])
  useEffect(()=>{
    const topicBoard = new URLSearchParams(location.search).get('topicBoard')
    if(topicBoard && window.parent !== window) parent.postMessage({type:'topic-board:reader-state',boardId:topicBoard,open:Boolean(reader)},location.origin)
  },[reader])
  function openNativeReader(reference: BoardPdfReference) {
    nativeRequest.current?.abort()
    const controller = new AbortController()
    nativeRequest.current = controller
    nativeReference.current = reference
    setNativeError('')
    void (reference.workspaceFileId
      ? openNativePdf(reference.workspaceFileId, controller.signal)
      : Promise.reject(new Error('Este acceso no tiene un archivo sincronizado. Volvé a publicarlo desde la computadora.'))
    ).catch(error => {
      if (!controller.signal.aborted) setNativeError(error.message)
    }).finally(() => { if (nativeRequest.current === controller) nativeRequest.current = null })
  }
  const panels = native ? (nativeError && <div role="alert" style={{position:'fixed',bottom:64,left:12,right:12,zIndex:3000,background:'white',color:'black',padding:16,borderRadius:12}}>
    <p>{nativeError}</p><button onClick={() => { if (nativeReference.current) openNativeReader(nativeReference.current) }}>Reintentar</button>
    <button onClick={() => setNativeError('')}>Cerrar</button>
  </div>) : <>
    {calendarTask && <div className="board-pdf-reader" role="dialog" aria-modal="true" aria-label="Calendario de importantes"><iframe ref={libraryFrame} title="Calendario de importantes" src={`/biblioteca/pizarra?mode=calendar&taskId=${encodeURIComponent(calendarTask)}&session=${session}&boardId=${encodeURIComponent(boardId)}`} /></div>}
    {splitOpen && !calendarTask && <iframe ref={libraryFrame} className="board-material-library" title="Biblioteca de Estudio"
      src={`/biblioteca/pizarra?session=${session}&boardId=${encodeURIComponent(boardId)}`} />}
    {/* Keep iframe DOM order stable: moving an iframe reloads its document in Chromium. */}
    {(reader ?? retained ? [reader ?? retained!] : []).map(reference => {
      const visible = reader?.materialId === reference.materialId && ready.has(reference.materialId)
      return <div key={`${boardId}:${reference.materialId}`} className="board-pdf-reader" role={visible ? 'dialog' : undefined}
        aria-modal={visible || undefined} aria-hidden={!visible} inert={!visible} aria-label={`Leer ${reference.fileName.replace(/\.pdf$/i,'')}`}
        style={{opacity:visible ? 1 : 0,pointerEvents:visible ? 'auto' : 'none'}}>
        <iframe ref={frame => { if(frame) readerFrames.current.set(reference.materialId,frame); else readerFrames.current.delete(reference.materialId) }}
          title="Lector de PDF de la pizarra" src={`/biblioteca/pizarra?mode=reader&session=${session}&boardId=${encodeURIComponent(boardId)}&materialId=${reference.materialId}`} />
      </div>
    })}
  </>
  return {splitOpen,setSplitOpen,reader,openCalendar:(taskId:string)=>{setSplitOpen(false);setCalendarTask(taskId)},openReader:(reference:BoardPdfReference, retain=false)=>{
    if (native) { openNativeReader(reference); return }
    setRetained(retain?reference:null)
    if(!readerFrames.current.has(reference.materialId))setReady(new Set())
    setReader(reference)
  },panels,
    closeReader:()=>{
      if(retained?.materialId===reader?.materialId) {setReader(null);document.querySelector<HTMLCanvasElement>('.app canvas')?.focus();return}
      if(!ready.has(reader?.materialId ?? -1)) {setReader(null);setReady(new Set());return}
      readerFrames.current.get(reader?.materialId ?? -1)?.contentWindow?.postMessage({type:'board-library:escape-reader',session,boardId},location.origin)
    }}
}
