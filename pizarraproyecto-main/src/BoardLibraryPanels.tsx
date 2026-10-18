import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { getTopicWorkspaceRoot } from './topicWorkspace'

export function useBoardLibrary(boardId: string, candidates: () => BoardPdfReference[]) {
  const [splitOpen,setSplitOpen] = useState(false)
  const [reader,setReader] = useState<BoardPdfReference | null>(null)
  const libraryFrame = useRef<HTMLIFrameElement>(null)
  const readerFrames = useRef(new Map<number, HTMLIFrameElement>())
  const [prepared, setPrepared] = useState<BoardPdfReference[]>([])
  const [ready, setReady] = useState<Set<number>>(new Set())
  useEffect(() => {
    const prepare = () => setPrepared(previous => {
      const wanted = [...new Map([...(frames.current.reader ? [frames.current.reader] : []), ...candidates()].map(item => [item.materialId, item])).values()].slice(0, 2)
      return JSON.stringify(previous) === JSON.stringify(wanted) ? previous : wanted
    })
    prepare()
    const timer = window.setInterval(prepare, 1000)
    return () => window.clearInterval(timer)
  }, [boardId])
  const session = useMemo(()=>crypto.randomUUID(),[boardId])
  const frames = useRef({reader,boardId,session})
  frames.current = {reader,boardId,session}
  useEffect(()=>{setSplitOpen(false);setReader(null);setPrepared([]);setReady(new Set())},[boardId])
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
      if(event.data.type === 'board-library:reader-closed' && isReader) {
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
  const panels = <>
    {splitOpen && <iframe ref={libraryFrame} className="board-material-library" title="Biblioteca de Estudio"
      src={`/biblioteca/pizarra?session=${session}&boardId=${encodeURIComponent(boardId)}`} />}
    {[...new Map([...(reader ? [reader] : []), ...prepared].map(item => [item.materialId, item])).values()].map(reference => {
      const visible = reader?.materialId === reference.materialId && ready.has(reference.materialId)
      return <div key={`${boardId}:${reference.materialId}`} className="board-pdf-reader" role={visible ? 'dialog' : undefined}
        aria-modal={visible || undefined} aria-hidden={!visible} inert={!visible} aria-label={`Leer ${reference.fileName.replace(/\.pdf$/i,'')}`}
        style={{opacity:visible ? 1 : 0,pointerEvents:visible ? 'auto' : 'none'}}>
        <iframe ref={frame => { if(frame) readerFrames.current.set(reference.materialId,frame); else readerFrames.current.delete(reference.materialId) }}
          title="Lector de PDF de la pizarra" src={`/biblioteca/pizarra?mode=reader&session=${session}&boardId=${encodeURIComponent(boardId)}&materialId=${reference.materialId}`} />
      </div>
    })}
  </>
  return {splitOpen,setSplitOpen,reader,openReader:(reference:BoardPdfReference)=>{setPrepared(previous=>[reference,...previous.filter(item=>item.materialId!==reference.materialId)].slice(0,2));setReader(reference)},panels,
    closeReader:()=>readerFrames.current.get(reader?.materialId ?? -1)?.contentWindow?.postMessage({type:'board-library:escape-reader',session,boardId},location.origin)}
}
