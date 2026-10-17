import { createRoot } from 'react-dom/client'
import App from '../pizarraproyecto-main/src/App'
import '../pizarraproyecto-main/src/index.css'
import { prepareNativeBoards } from '../pizarraproyecto-main/src/nativeWorkspace'

prepareNativeBoards().then(() => createRoot(document.getElementById('root')).render(<App />)).catch(error => {
  const host = document.getElementById('root')
  const text = document.createElement('p'); text.textContent = error.message
  const retry = document.createElement('button'); retry.textContent = 'Reintentar'; retry.onclick = () => location.reload()
  host.replaceChildren(text, retry)
  const boardId=new URLSearchParams(location.search).get('topicBoard')
  if(boardId) parent.postMessage({type:'topic-board:error',boardId,error:error.message},location.origin)
})
