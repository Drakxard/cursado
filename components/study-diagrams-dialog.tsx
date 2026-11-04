'use client'

import { useEffect, useRef, useState } from 'react'
import { renderStudyMindmap } from '@/lib/client/study-plantuml'
import { renderStudyMermaid } from '@/lib/client/study-mermaid'
import { PlantUmlPromptButton } from './plantuml-prompt-button'
import { StudyDiagramPreview } from './study-diagram-preview'
import './study-diagrams.css'

function PlantUmlSketch() {
  return <svg viewBox="0 0 340 130" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2"><path d="M90 64h35l25-37h45M125 64l25 35h45M265 99h18l16 16" /><ellipse cx="52" cy="64" rx="42" ry="15" /><ellipse cx="234" cy="27" rx="45" ry="15" /><ellipse cx="234" cy="99" rx="45" ry="15" /><ellipse cx="311" cy="115" rx="22" ry="10" /></g></svg>
}

export function StudyDiagramsDialog({ onClose, onInsert, initialSource, editing = false }: { onClose: () => void; onInsert: (file: File, source: string, rootFile?: File) => Promise<void>; initialSource?: string; editing?: boolean }) {
  const [view, setView] = useState<'choose' | 'plantuml' | 'mermaid'>(initialSource !== undefined ? (/^\s*mindmap\s*$/m.test(initialSource) ? 'mermaid' : 'plantuml') : 'choose')
  const title = view === 'mermaid' ? 'Mermaid Mindmap' : 'PlantUML'
  const codeLabel = view === 'mermaid' ? 'Código Mermaid' : 'Código PlantUML'
  const [source, setSource] = useState(initialSource || ''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [inserting, setInserting] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const maximizedRef = useRef(false)
  maximizedRef.current = maximized
  const [preview, setPreview] = useState<{ source: string; blob: Blob; url: string } | null>(null)
  const [progress, setProgress] = useState({ percent: 0, stage: 'Preparando…' })
  const dialog = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null)
  const closeRef = useRef(onClose), insertingRef = useRef(inserting)
  closeRef.current = onClose; insertingRef.current = inserting
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('[data-plantuml-prompt-editor]')) return
      if (event.key === 'Escape' && maximizedRef.current) { event.preventDefault(); event.stopPropagation(); setMaximized(false); return }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!insertingRef.current) closeRef.current() }
      if (event.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),textarea,[tabindex="0"]') || [])].filter(element => element.getClientRects().length > 0)
        const first = elements[0], last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); previous?.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => { if (view !== 'choose') textarea.current?.focus(); else setMaximized(false) }, [view])
  useEffect(() => {
    if (view === 'choose' || !source.trim()) { setLoading(false); return }
    const controller = new AbortController()
    let url: string | undefined
    setLoading(true); setError(''); setProgress({ percent: 0, stage: 'Preparando…' })
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let blob: Blob
          if (view === 'mermaid') {
            setProgress({ percent: 10, stage: 'Generando mapa Mermaid…' })
            blob = await renderStudyMermaid(source, controller.signal)
            if (!controller.signal.aborted) setProgress({ percent: 100, stage: 'Mapa listo' })
          } else if (/@startmindmap\b/i.test(source.replace(/[\u200B-\u200D\u2060\uFEFF]/g, ''))) {
            blob = await renderStudyMindmap(source, controller.signal, (percent, stage) => {
              if (!controller.signal.aborted) setProgress(current => ({ percent: Math.max(current.percent, percent), stage }))
            })
          } else {
            const response = await fetch('/api/diagrams/plantuml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }), signal: controller.signal })
            if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'No se pudo renderizar el diagrama.') }
            blob = await response.blob()
          }
          if (!blob.type.startsWith('image/png')) throw new Error('La vista previa no es una imagen válida.')
          if (controller.signal.aborted) return
          url = URL.createObjectURL(blob)
          setPreview({ source, blob, url }); setLoading(false)
        } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) } }
      })()
    }, 600)
    return () => { clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [source, view])
  async function insert() {
    if (!preview || preview.source !== source || loading || inserting) return
    setInserting(true); setError('')
    try {
      const rootBlob = view === 'mermaid' ? await renderStudyMermaid(source, new AbortController().signal, true) : /@startmindmap\b/i.test(source.replace(/[\u200B-\u200D\u2060\uFEFF]/g, ''))
        ? await renderStudyMindmap(source, new AbortController().signal, undefined, true) : undefined
      await onInsert(new File([preview.blob], `diagrama-${view}.png`, { type: 'image/png' }), source,
        rootBlob ? new File([rootBlob], `raiz-${view}.png`, { type: 'image/png' }) : undefined)
      onClose()
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setInserting(false) }
  }
  return <div className={`study-diagrams-backdrop${maximized ? ' study-diagrams-maximized' : ''}`} style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
    <div ref={dialog} className="study-diagrams" role="dialog" aria-modal="true" aria-labelledby="study-diagrams-title">
      <header><div>{view !== 'choose' && <button className="study-diagrams-back" type="button" disabled={inserting} onClick={() => setView('choose')} aria-label="Volver a Diagramas">←</button>}<h2 id="study-diagrams-title">{view === 'choose' ? 'Diagramas' : title}</h2>{view === 'plantuml' && <PlantUmlPromptButton disabled={inserting} />}</div><button type="button" disabled={inserting} onClick={onClose} aria-label="Cerrar diagramas">×</button></header>
      {view === 'choose' ? <div className="study-diagrams-choices">
        <button type="button" className="study-diagrams-choice" onClick={() => { setSource(''); setPreview(null); setError(''); setView('plantuml') }}><h3>PlantUML</h3><PlantUmlSketch /><span>Crear desde código</span></button>
        <button type="button" className="study-diagrams-choice" onClick={() => { setSource(''); setPreview(null); setError(''); setView('mermaid') }}><h3>Mermaid Mindmap</h3><PlantUmlSketch /><span>Crear mapa mental desde código</span></button>
        <button type="button" className="study-diagrams-choice" disabled><h3>Venn</h3><svg viewBox="0 0 340 130" aria-hidden="true"><ellipse cx="132" cy="67" rx="75" ry="53" fill="#67c5db" fillOpacity=".7" stroke="#334155" strokeWidth="2" /><ellipse cx="218" cy="61" rx="75" ry="53" fill="#ff867c" fillOpacity=".7" stroke="#334155" strokeWidth="2" /></svg><span>Próximamente</span></button>
      </div> : <div className="study-diagrams-workspace">
        <label className="study-diagrams-code"><span>{codeLabel}</span><textarea ref={textarea} aria-label={codeLabel} spellCheck={false} maxLength={100000} disabled={inserting} value={source} onChange={event => { setPreview(null); setError(''); setSource(event.target.value) }} placeholder={view === 'mermaid' ? 'mindmap\n  root((Tema))\n    Rama\n      Subtema' : '@startuml\nAlice -> Bob: Hola\nBob --> Alice: ¡Hola!\n@enduml'} /></label>
        <section className="study-diagrams-preview" aria-label="Vista previa del diagrama" aria-busy={loading}><span>Vista previa</span>{preview?.source === source && !loading ? <StudyDiagramPreview label={title} key={preview.url} url={preview.url} maximized={maximized} onMaximize={() => setMaximized(current => !current)} onError={() => { setPreview(null); setError('No se pudo leer la imagen del diagrama.') }} /> : <div>{loading ? <div className="study-diagrams-progress">
          <span role="status">{progress.stage}</span>
          <div className="study-diagrams-progress-track" role="progressbar" aria-label="Renderizado del diagrama" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><div style={{ width: `${progress.percent}%` }} /></div>
          <small>{progress.percent}%</small>
        </div> : <p role="status">{error ? 'Revisá el código para continuar.' : 'Pegá tu código para ver el diagrama.'}</p>}</div>}</section>
      </div>}
      {error && <p className="study-diagrams-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={inserting} onClick={onClose}>Cancelar</button>{view !== 'choose' && <button type="button" className="study-diagrams-insert" disabled={!preview || preview.source !== source || loading || inserting} onClick={() => void insert()}>{inserting ? 'Insertando…' : editing ? 'Reinsertar' : 'Insertar'} <span aria-hidden="true">→</span></button>}</footer>
    </div>
  </div>
}
