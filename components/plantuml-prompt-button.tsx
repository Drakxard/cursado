'use client'

import { useEffect, useRef, useState } from 'react'

const DEFAULT_PROMPT = 'Puedes expresar  los temas y subtemas, solo sus nombres e implicaciones en PlantUML Mindmap, cómo arbol de implicaciones horizontal.'
const STORAGE_KEY = 'cursado-plantuml-prompt'

export function PlantUmlPromptButton({ disabled }: { disabled?: boolean }) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const feedback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  const start = useRef({ x: 0, y: 0 })
  const stopHold = () => { clearTimeout(hold.current) }

  useEffect(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved?.trim()) setPrompt(saved) } catch {}
    return () => { clearTimeout(hold.current); clearTimeout(feedback.current) }
  }, [])
  useEffect(() => { if (editing) input.current?.focus() }, [editing])

  function edit() {
    setDraft(prompt); setError(''); setCopied(false); setEditing(true)
  }
  function close() { setEditing(false); button.current?.focus() }
  async function copy() {
    if (held.current) { held.current = false; return }
    try {
      await navigator.clipboard.writeText(prompt)
      setError(''); setCopied(true)
      clearTimeout(feedback.current)
      feedback.current = setTimeout(() => setCopied(false), 1600)
    } catch { setError('No se pudo copiar. Mantené presionado para editar y copiar el texto.') }
  }

  return <div className="plantuml-prompt-control">
    <button ref={button} className="plantuml-prompt-copy" type="button" disabled={disabled}
      aria-label="Copiar prompt de PlantUML" title="Copiar prompt · Mantené presionado para editar"
      aria-expanded={editing} aria-controls={editing ? 'plantuml-prompt-editor' : undefined}
      onClick={() => void copy()}
      onPointerDown={event => {
        if (event.button !== 0) return
        stopHold(); held.current = false
        start.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
        hold.current = setTimeout(() => { held.current = true; edit() }, 550)
      }}
      onPointerMove={event => {
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) { stopHold(); held.current = true }
      }}
      onPointerUp={stopHold} onPointerCancel={() => { stopHold(); held.current = true }} onLostPointerCapture={stopHold}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'F2' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); edit() }
        if (event.key === 'Enter' || event.key === ' ') held.current = false
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>}
      </svg>
    </button>
    <span className="plantuml-prompt-announcement" role="status">{copied ? 'Prompt copiado' : ''}</span>
    {error && <span className="plantuml-prompt-error" role="alert">{error}</span>}
    {editing && <form id="plantuml-prompt-editor" data-plantuml-prompt-editor className="plantuml-prompt-editor"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}
      onSubmit={event => {
        event.preventDefault()
        if (!draft.trim()) return
        setPrompt(draft)
        try { localStorage.setItem(STORAGE_KEY, draft) } catch {}
        close()
      }}>
      <label htmlFor="plantuml-prompt-text">Prompt de PlantUML</label>
      <textarea ref={input} id="plantuml-prompt-text" value={draft} onChange={event => setDraft(event.target.value)} rows={5} maxLength={10000} />
      <div><button type="button" onClick={close}>Cancelar edición</button><button type="submit" disabled={!draft.trim()}>Guardar prompt</button></div>
    </form>}
  </div>
}
