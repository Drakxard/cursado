import {hasBoardReturn,isBoardNavigating} from './boardNavigation'
import { useEffect, useState } from 'react'
import App from './App'
import { flushNavigationSaves } from './homeNavigation'
import { initializeTopicWorkspace, notifyTopicWorkspace, saveTopicWorkspace } from './topicWorkspace'

export default function EmbeddedTopicBoard() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let initialized = false, closing = false, alive = true
    const boardId = new URLSearchParams(location.search).get('topicBoard')
    const close = async () => {
      if (closing || !initialized) return
      closing = true
      try {
        if(isBoardNavigating()){parent.postMessage({type:'topic-board:ready',boardId},location.origin);return}
        if(hasBoardReturn()){
          await new Promise<void>((resolve,reject)=>window.dispatchEvent(new CustomEvent('board-link:back',{detail:{resolve,reject}})))
          parent.postMessage({type:'topic-board:ready',boardId},location.origin)
          return
        }
        await flushNavigationSaves()
        await saveTopicWorkspace()
        notifyTopicWorkspace('closed')
      } catch (reason) {
        const message = String(reason)
        if (alive) setError(message)
        parent.postMessage({type:'topic-board:error',boardId,error:message},location.origin)
      } finally { closing = false }
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.boardId !== boardId) return
      if (event.data.type === 'topic-board:init' && !initialized) {
        initialized = true
        void initializeTopicWorkspace({ boardId: boardId!, name: String(event.data.name || 'Tema'), rootHandle: event.data.rootHandle, pdfReferences: event.data.pdfReferences, cooperationWeekNumber: event.data.cooperationWeekNumber, cooperationSubjectId: event.data.cooperationSubjectId }).then(() => {
          if (alive) setReady(true)
        }).catch(reason => {
          const message = String(reason)
          if (alive) setError(message)
          parent.postMessage({ type: 'topic-board:error', boardId, error: message }, location.origin)
        })
      }
      if (event.data.type === 'topic-board:close') void close()
    }
    window.addEventListener('message', receive)
    parent.postMessage({ type: 'topic-board:request-init', boardId }, location.origin)
    return () => {
      alive = false
      window.removeEventListener('message', receive)
    }
  }, [])
  return <>{error && <div role="alert" style={{ position: 'fixed', bottom: 16, left: 16, zIndex: 9999, background: '#fee2e2', padding: 12 }}>{error}</div>}{ready && <App />}</>
}
