/// <reference path="../../../types/file-system-access.d.ts" />
import { useEffect, useRef, useState } from 'react'
import { loadServicesFile, loadWorkspaceHandle } from '../../../lib/local-workspace-client'
import type { BoardChatMessage } from '../../../lib/board-chat'
import { getTopicWorkspaceRoot } from '../topicWorkspace'
import { mathMarkup, messageParts } from '../assistant/messageFormat'
import './BoardApiChat.css'

function FormattedText({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2,-2)}</strong> : /^\*[^*]+\*$/.test(part) ? <em key={i}>{part.slice(1,-1)}</em> : part)
}
export default function BoardApiChat({ image, onClose }: { image: string; onClose: () => void }) {
  const [question,setQuestion] = useState(''), [answer,setAnswer] = useState('')
  const [sendImage,setSendImage] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null), request = useRef<AbortController | null>(null)
  const context = useRef<BoardChatMessage[]>([]), alive = useRef(true)
  useEffect(() => {
    alive.current=true; input.current?.focus()
    return () => { alive.current=false; request.current?.abort() }
  }, [])
  async function submit() {
    if (request.current || !question.trim()) return
    const controller = new AbortController(); request.current=controller
    const text=question.trim(); setBusy(true); setError('')
    try {
      // Each board iframe loads the same encrypted services file as the main app.
      const root=getTopicWorkspaceRoot() ?? await loadWorkspaceHandle()
      const services=root ? await loadServicesFile(root) : null
      if(controller.signal.aborted)return
      const response=await fetch('/api/board-chat', { method:'POST', signal:controller.signal,
        headers:{'Content-Type':'application/json', ...(services?.inscreenToken ? {'x-inscreen-config-token':services.inscreenToken} : {})},
        body:JSON.stringify({question:text, ...(sendImage ? {image} : {}), context:context.current}),
      })
      const result=await response.json().catch(()=>{throw new Error('No se pudo consultar GPT-5 mini. Reintentá.')})
      if(!response.ok)throw new Error(result.error || 'No se pudo consultar GPT-5 mini.')
      if(typeof result.answer!=='string'||!result.answer.trim())throw new Error('La respuesta está vacía. Reintentá.')
      if(!alive.current)return
      context.current=[...context.current,{role:'user' as const,content:text},{role:'assistant' as const,content:result.answer}].slice(-20)
      while(JSON.stringify(context.current).length>100000)context.current.splice(0,2)
      setAnswer(result.answer);setQuestion('')
    } catch(e) {
      if(alive.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'No se pudo enviar la consulta.')
    } finally {
      if(request.current===controller)request.current=null
      if(alive.current){setBusy(false);requestAnimationFrame(()=>input.current?.focus())}
    }
  }
  return <section className="board-api-chat-backdrop" role="dialog" aria-modal="true" aria-label="API chat"
    onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}
    onKeyDown={e=>{
      e.stopPropagation()
      if(e.key==='Escape'){e.preventDefault();request.current?.abort();onClose()}
      if(e.key==='Tab'){
        const nodes=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input:not(:disabled),[tabindex="0"]')]
        const first=nodes[0],last=nodes.at(-1)
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
      }
    }}>
    <div className="board-api-chat">
      {answer&&<div className="board-api-chat-answer" role="region" aria-label="Respuesta de GPT-5 mini" tabIndex={0}>
        {messageParts(answer).map((part,i)=>{
          const html=part.kind==='math'?mathMarkup(part.text,part.display):null
          return html?<span key={i} dangerouslySetInnerHTML={{__html:html}}/>:part.kind==='code'?<pre key={i}>{part.text}</pre>:<FormattedText key={i} text={part.text}/>
        })}
      </div>}
      <form className="board-api-chat-prompt" onSubmit={e=>{e.preventDefault();void submit()}}>
        <div className="board-api-chat-actions"><label><input type="checkbox" role="switch" checked={sendImage} disabled={busy} onChange={e=>setSendImage(e.target.checked)}/> Enviar imagen</label>
          <button type="button" onClick={()=>{request.current?.abort();onClose()}} aria-label="Cerrar API chat">×</button></div>
        <div className="board-api-chat-input"><span aria-hidden="true">{error?'!':'>'}</span><textarea ref={input} aria-label="Pregunta para GPT-5 mini" placeholder="Escribí tu pregunta…" maxLength={12000} value={question} readOnly={busy}
          onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();void submit()}}}/></div>
        {busy&&<p role="status">Consultando GPT-5 mini…</p>}
        {error&&<p role="alert">{error}</p>}
        <button type="submit" disabled={busy||!question.trim()}>Enviar ↵</button>
      </form>
    </div>
  </section>
}
