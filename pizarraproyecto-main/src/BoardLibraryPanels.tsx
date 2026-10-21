import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { getTopicWorkspaceRoot } from './topicWorkspace'
import { isNativeReadOnly, openNativePdf } from '../../lib/native-workspace'

// Keep only the last opened reader, including its page and zoom while closed.
export function useBoardLibrary(boardId: string) {
  const native = isNativeReadOnly()
  const [nativeError, setNativeError] = useState('')
  const nativeRequest = useRef<AbortController | null>(null)
  const nativeReference = useRef<BoardPdfReference | null>(null)
  const [splitOpen,setSplitOpen] = useState(false)
  const [reader,setReader] = useState<BoardPdfReference | null>(null)
  const libraryFrame = useRef<HTMLIFrameElement>(null)
  const readerFrames = useRef(new Map<number, HTMLIFrameElement>())
  const [prepared, setPrepared] = useState<BoardPdfReference[]>([])
  const [ready, setReady] = useState<Set<number>>(new Set())
  const session = useMemo(()=>crypto.randomUUID(),[boardId])
  const frames = useRef({reader,boardId,session})
  frames.current = {reader,boardId,session}
  useEffect(()=>{setSplitOpen(false);setReader(null);setPrepared([]);setReady(new Set())},[boardId])
  useEffect(() => {
    setNativeError('')
    return () => { nativeRequest.current?.abort(); nativeRequest.current = null }
  }, [boardId])
  useEffect(()=>{
    const retained=new Set(prepared.map(item=>item.materialId))
    setReady(previous=>{
      const next=new Set([...previous].filter(id=>retained.has(id)))
      return next.size===previous.size?previous:next
    })
  },[prepared])
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
          rootHandle:getTopicWorkspaceRoot(),reference:readerEntry ? prepared.find(item => item.materialId === readerEntry[0]) : null},location.origin)
      }
      if(event.data.type === 'board-library:reader-rendered' && readerEntry) setReady(previous => new Set([...previous, readerEntry[0]]))
      if(event.data.type === 'board-library:escape' && isLibrary && !frames.current.reader) {
        setSplitOpen(false)
        document.querySelector<HTMLCanvasElement>('.app canvas')?.focus()
      }
      if(event.data.type === 'board-library:reader-closed' && readerEntry && readerEntry[0]===frames.current.reader?.materialId) {
        setReader(null)
        document.querySelector<HTMLCanvasElement>('.app canvas')?.focus()
      }
    }
    window.addEventListener('message',receive)
    return ()=>window.removeEventListener('message',receive)
  },[boardId,session,prepared])
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
    {splitOpen && <iframe ref={libraryFrame} className="board-material-library" title="Biblioteca de Estudio"
      src={`/biblioteca/pizarra?session=${session}&boardId=${encodeURIComponent(boardId)}`} />}
    {/* Keep iframe DOM order stable: moving an iframe reloads its document in Chromium. */}
    {[...new Map([...(reader ? [reader] : []), ...prepared].map(item => [item.materialId, item])).values()].sort((a,b)=>a.materialId-b.materialId).map(reference => {
      const visible = reader?.materialId === reference.materialId && ready.has(reference.materialId)
      return <div key={`${boardId}:${reference.materialId}`} className="board-pdf-reader" role={visible ? 'dialog' : undefined}
        aria-modal={visible || undefined} aria-hidden={!visible} inert={!visible} aria-label={`Leer ${reference.fileName.replace(/\.pdf$/i,'')}`}
        style={{opacity:visible ? 1 : 0,pointerEvents:visible ? 'auto' : 'none'}}>
        <iframe ref={frame => { if(frame) readerFrames.current.set(reference.materialId,frame); else readerFrames.current.delete(reference.materialId) }}
          title="Lector de PDF de la pizarra" src={`/biblioteca/pizarra?mode=reader&session=${session}&boardId=${encodeURIComponent(boardId)}&materialId=${reference.materialId}`} />
      </div>
    })}
  </>
  return {splitOpen,setSplitOpen,reader,openReader:(reference:BoardPdfReference)=>{
    if (native) { openNativeReader(reference); return }
    if(!readerFrames.current.has(reference.materialId))setReady(new Set())
    setPrepared([reference])
    setReader(reference)
  },panels,
    closeReader:()=>readerFrames.current.get(reader?.materialId ?? -1)?.contentWindow?.postMessage({type:'board-library:escape-reader',session,boardId},location.origin)}
}
