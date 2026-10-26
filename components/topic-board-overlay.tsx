"use client"

import { useEffect, useRef, useState } from "react"
import type { BoardPdfReference } from "@/lib/board-library-contract"
import { isNativeReadOnly } from '@/lib/native-workspace'
import { cooperationPresence, cooperationState, sendCooperationEditor } from '@/lib/client/cooperation'
import { mapBindingText } from '@/lib/client/cooperation-files'

export function TopicBoardOverlay({ boardId, name, rootHandle, onClose, pdfReferences, cooperationSubjectId, cooperationWeekNumber, backLabel = "Volver a Temas" }: {
  cooperationWeekNumber?: number
  cooperationSubjectId?: string
  pdfReferences?: BoardPdfReference[]
  backLabel?: string
  boardId: string
  name: string
  rootHandle: FileSystemDirectoryHandle
  onClose: () => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const currentBoard = useRef({ boardId, cooperationSubjectId })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const [closing, setClosing] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  const [background] = useState(() => {
    try {
      const theme = localStorage.getItem('pizarra-theme')
      return theme === 'dark' ? '#171b24' : theme === 'rest' ? '#eee5d3' : '#ffffff'
    } catch { return '#ffffff' }
  })
  useEffect(() => {
    currentBoard.current = { boardId, cooperationSubjectId }
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'topic-board:context') {
        currentBoard.current = { boardId:event.data.boardId, cooperationSubjectId:event.data.cooperationSubjectId }
        return
      }
      if (event.data?.type === 'topic-board:ephemeral') {
        const current = currentBoard.current
        if (current.cooperationSubjectId && event.data.boardId === current.boardId) sendCooperationEditor(current.cooperationSubjectId, current.boardId, event.data.payload)
        return
      }
      if (event.data?.boardId !== boardId && !['topic-board:saved','topic-board:closed','topic-board:error'].includes(event.data?.type)) return
      if (event.data.type === "topic-board:request-init") {
        try {
          if (!isNativeReadOnly()) frame.current?.contentWindow?.postMessage({ type: "topic-board:init", boardId, name, rootHandle, pdfReferences, cooperationSubjectId, cooperationWeekNumber }, location.origin)
        } catch (reason) { setError(String(reason)) }
      }
      if (event.data.type === "topic-board:ready") {
        setReady(true); setClosing(false); frame.current?.focus()
        if (cooperationSubjectId) frame.current?.contentWindow?.postMessage({ type: 'topic-board:live', boardId, payload: { type: 'presence', ...cooperationPresence(cooperationSubjectId) } }, location.origin)
      }
      if (event.data.type === 'topic-board:ephemeral' && cooperationSubjectId) sendCooperationEditor(cooperationSubjectId, boardId, event.data.payload)
      if (event.data.type === 'topic-board:saved') window.dispatchEvent(new Event('cursado-workspace-saved'))
      if (event.data.type === "topic-board:closed") onClose()
      if (event.data.type === "topic-board:reader-state") setReaderOpen(event.data.open === true)
      if (event.data.type === "topic-board:error") { setError(event.data.error || "No se pudo guardar la pizarra."); setClosing(false) }
    }
    window.addEventListener("message", receive)
    const refresh = () => frame.current?.contentWindow?.postMessage({ type: 'topic-board:refresh', boardId }, location.origin)
    window.addEventListener('cursado-cooperation-applied', refresh)
    const live = (event: Event) => {
      const current = currentBoard.current
      if (!current.cooperationSubjectId) return
      const message = (event as CustomEvent).detail
      const b = cooperationState().mirrors[message.sphereId]?.binding
      const important = current.cooperationSubjectId === `important-share:${message.sphereId}`
      if (!important && b?.subjectId !== current.cooperationSubjectId) return
      if (message.type === 'editor' && (b ? mapBindingText(message.document, b, true) : message.document) !== current.boardId) return
      frame.current?.contentWindow?.postMessage({ type: 'topic-board:live', boardId: current.boardId, payload: message.type === 'presence' ? message : message.payload }, location.origin)
    }
    window.addEventListener('cursado-cooperation-editor', live)
    window.addEventListener('cursado-cooperation-presence', live)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("message", receive)
      window.removeEventListener('cursado-cooperation-applied', refresh)
      window.removeEventListener('cursado-cooperation-editor', live)
      window.removeEventListener('cursado-cooperation-presence', live)
      previousFocus?.focus({ preventScroll: true })
    }
  }, [boardId, name, rootHandle, onClose, pdfReferences, cooperationSubjectId, cooperationWeekNumber])
  const close = () => {
    if (isNativeReadOnly()) { onClose(); return }
    if (!ready) { onClose(); return }
    setClosing(true)
    setError("")
    frame.current?.contentWindow?.postMessage({ type: "topic-board:close", boardId }, location.origin)
  }
  return <div role="dialog" aria-modal="true" aria-label={`Pizarra de ${name}`} className="fixed inset-0 z-[150] flex flex-col text-slate-900" style={{background}}>
    {!readerOpen && <button type="button" aria-label={backLabel} title={backLabel} disabled={closing} onClick={close}
      className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-xl border bg-white text-xl shadow-sm">{closing ? "…" : "←"}</button>}
    {error && <p role="alert" className="absolute bottom-4 left-4 z-10 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
    {!ready && !error && <p role="status" className="absolute bottom-4 left-4 z-10 px-4 py-2 text-sm text-slate-500">Abriendo pizarra…</p>}
    <iframe ref={frame} title={`Pizarra de ${name}`} src={`/pizarra/?topicBoard=${encodeURIComponent(boardId)}`} className="min-h-0 w-full flex-1 border-0"
      style={{visibility:ready ? 'visible' : 'hidden',background}}
      onLoad={() => {
        try {
          if (!isNativeReadOnly()) frame.current?.contentWindow?.postMessage({ type: "topic-board:init", boardId, name, rootHandle, pdfReferences, cooperationSubjectId, cooperationWeekNumber }, location.origin)
        } catch (reason) { setError(String(reason)) }
      }} />
  </div>
}
