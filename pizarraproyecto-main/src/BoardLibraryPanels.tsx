import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardPdfReference } from '../../lib/board-library-contract'
import { getTopicWorkspaceRoot } from './topicWorkspace'

export function useBoardLibrary(boardId: string) {
  const [splitOpen,setSplitOpen] = useState(false)
  const [reader,setReader] = useState<BoardPdfReference | null>(null)
  const libraryFrame = useRef<HTMLIFrameElement>(null)
  const readerFrame = useRef<HTMLIFrameElement>(null)
  const session = useMemo(()=>crypto.randomUUID(),[boardId])
  const frames = useRef({reader,boardId,session})
  frames.current = {reader,boardId,session}
  useEffect(()=>{setSplitOpen(false);setReader(null)},[boardId])
  useEffect(()=>{
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.session !== session || event.data?.boardId !== boardId) return
      const isReader = event.source === readerFrame.current?.contentWindow
      const isLibrary = event.source === libraryFrame.current?.contentWindow
      if (!isReader && !isLibrary) return
      if(event.data.type === 'board-library:ready') {
        const target = isReader ? readerFrame.current : libraryFrame.current
        target?.contentWindow?.postMessage({type:'board-library:init',session,boardId,
          rootHandle:getTopicWorkspaceRoot(),reference:isReader ? frames.current.reader : null},location.origin)
      }
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
  },[boardId,session])
  useEffect(()=>{
    const topicBoard = new URLSearchParams(location.search).get('topicBoard')
    if(topicBoard && window.parent !== window) parent.postMessage({type:'topic-board:reader-state',boardId:topicBoard,open:Boolean(reader)},location.origin)
  },[reader])
  const panels = <>
    {splitOpen && <iframe ref={libraryFrame} className="board-material-library" title="Biblioteca de Estudio"
      src={`/biblioteca/pizarra?session=${session}&boardId=${encodeURIComponent(boardId)}`} />}
    {reader && <div className="board-pdf-reader" role="dialog" aria-modal="true" aria-label={`Leer ${reader.fileName.replace(/\.pdf$/i,'')}`}>
      <iframe ref={readerFrame} title="Lector de PDF de la pizarra" src={`/biblioteca/pizarra?mode=reader&session=${session}&boardId=${encodeURIComponent(boardId)}`} />
    </div>}
  </>
  return {splitOpen,setSplitOpen,reader,openReader:setReader,panels,
    closeReader:()=>readerFrame.current?.contentWindow?.postMessage({type:'board-library:escape-reader',session,boardId},location.origin)}
}
