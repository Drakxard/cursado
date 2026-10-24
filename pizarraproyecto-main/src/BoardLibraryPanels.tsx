import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { getTopicWorkspaceRoot } from './topicWorkspace'
import { isNativeReadOnly, openNativePdf } from '../../lib/native-workspace'
import { isLinkGuest, sharedPdfUrl } from './linkSharing'
import { readDeviceBoard } from './storage/device'
import type { ShapeItem } from './canvas/visualObjects'

function SharedPdfFrame({boardId,reference,readingPosition,frameRef,onReady,onError}:{boardId:string;reference:BoardPdfReference;readingPosition?:string;frameRef:(frame:HTMLIFrameElement|null)=>void;onReady:()=>void;onError:(error:string)=>void}) {
  const [url,setUrl]=useState('')
  useEffect(()=>{let alive=true;void sharedPdfUrl(boardId,reference).then(url=>{if(alive)setUrl(`/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}&boardReader=1&sharedBoardReader=1&fileName=${encodeURIComponent(reference.fileName)}${readingPosition||''}`)}).catch(error=>{if(alive)onError(error.message)});return()=>{alive=false}},[boardId,reference.sharedFileId])
  return url?<iframe ref={frameRef} title={`Leer ${reference.fileName}`} src={url} onLoad={onReady}/>:<p role="status">Abriendo PDF…</p>
}

function SharedPdfLibrary({boardId,onOpen}:{boardId:string;onOpen:(reference:BoardPdfReference)=>void}) {
  const [references,setReferences]=useState<BoardPdfReference[]>([])
  useEffect(()=>{let alive=true;void readDeviceBoard(boardId).then(board=>{if(alive)setReferences(((board?.content.shapes||[]) as ShapeItem[]).flatMap(shape=>shape.pdfReference?[shape.pdfReference]:[]))});return()=>{alive=false}},[boardId])
  return <aside className="board-material-library" style={{background:'white',color:'#222',padding:16}}><h2>PDF de esta pizarra</h2>{references.map(reference=><button key={reference.sharedFileId} onClick={()=>onOpen(reference)}>{reference.fileName}</button>)}{!references.length&&<p>Esta pizarra no tiene PDF vinculados.</p>}</aside>
}

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
      if(isLinkGuest() && event.origin===location.origin) {
        const entry=[...readerFrames.current].find(([,frame])=>event.source===frame.contentWindow)
        if(entry && event.data?.type==='viewerReadingPosition' && typeof event.data.hash==='string' && event.data.hash.length<=512)readingPositions.current.set(entry[0],event.data.hash)
        if(entry && event.data?.type==='shared-pdf:closed'){setReader(null);document.querySelector<HTMLCanvasElement>('.app canvas')?.focus();return}
        if(entry && event.data?.type==='viewerDocumentError'){setNativeError(String(event.data.error||'No se pudo abrir el PDF.'));setReader(null);return}
      }
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
    {nativeError&&<div role="alert" className="anon-toast">{nativeError}<button onClick={()=>{setNativeError('');if(nativeReference.current)setReader(nativeReference.current)}}>Reintentar</button><button onClick={()=>setNativeError('')}>Cerrar</button></div>}
    {calendarTask && <div className="board-pdf-reader" role="dialog" aria-modal="true" aria-label="Calendario de importantes"><iframe ref={libraryFrame} title="Calendario de importantes" src={`/biblioteca/pizarra?mode=calendar&taskId=${encodeURIComponent(calendarTask)}&session=${session}&boardId=${encodeURIComponent(boardId)}`} /></div>}
    {splitOpen && !calendarTask && isLinkGuest() && <SharedPdfLibrary boardId={boardId} onOpen={reference=>{setReader(reference);setSplitOpen(false)}}/>}
    {splitOpen && !calendarTask && !isLinkGuest() && <iframe ref={libraryFrame} className="board-material-library" title="Biblioteca de Estudio"
      src={`/biblioteca/pizarra?session=${session}&boardId=${encodeURIComponent(boardId)}`} />}
    {/* Keep iframe DOM order stable: moving an iframe reloads its document in Chromium. */}
    {(reader ?? retained ? [reader ?? retained!] : []).map(reference => {
      const visible = reader?.materialId === reference.materialId && ready.has(reference.materialId)
      return <div key={`${boardId}:${reference.materialId}`} className="board-pdf-reader" role={visible ? 'dialog' : undefined}
        aria-modal={visible || undefined} aria-hidden={!visible} inert={!visible} aria-label={`Leer ${reference.fileName.replace(/\.pdf$/i,'')}`}
        style={{opacity:visible ? 1 : 0,pointerEvents:visible ? 'auto' : 'none'}}>
        {isLinkGuest()?<SharedPdfFrame boardId={boardId} reference={reference} readingPosition={readingPositions.current.get(reference.materialId)}
          frameRef={frame=>{if(frame)readerFrames.current.set(reference.materialId,frame);else readerFrames.current.delete(reference.materialId)}}
          onReady={()=>setReady(previous=>new Set([...previous,reference.materialId]))} onError={message=>{nativeReference.current=reference;setNativeError(message);setReader(null)}}/>:<iframe ref={frame => { if(frame) readerFrames.current.set(reference.materialId,frame); else readerFrames.current.delete(reference.materialId) }}
          title="Lector de PDF de la pizarra" src={`/biblioteca/pizarra?mode=reader&session=${session}&boardId=${encodeURIComponent(boardId)}&materialId=${reference.materialId}`} />}
      </div>
    })}
  </>
  return {splitOpen,setSplitOpen,reader,openCalendar:(taskId:string)=>{if(isLinkGuest()){setNativeError('Esta tarea no forma parte de las pizarras compartidas.');return}setSplitOpen(false);setCalendarTask(taskId)},openReader:(reference:BoardPdfReference, retain=false)=>{
    nativeReference.current=reference
    if (native) { openNativeReader(reference); return }
    setRetained(retain?reference:null)
    if(!readerFrames.current.has(reference.materialId))setReady(new Set())
    setReader(reference)
  },panels,
    closeReader:()=>{
      if(isLinkGuest()){setReader(null);if(!retained)setReady(new Set());return}
      if(retained?.materialId===reader?.materialId) {setReader(null);document.querySelector<HTMLCanvasElement>('.app canvas')?.focus();return}
      if(!ready.has(reader?.materialId ?? -1)) {setReader(null);setReady(new Set());return}
      readerFrames.current.get(reader?.materialId ?? -1)?.contentWindow?.postMessage({type:'board-library:escape-reader',session,boardId},location.origin)
    }}
}
