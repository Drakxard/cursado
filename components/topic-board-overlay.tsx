"use client"

import { useEffect, useRef, useState } from "react"
import { isNativeReadOnly } from '@/lib/native-workspace'

export function TopicBoardOverlay({ boardId, name, rootHandle, onClose }: {
  boardId: string
  name: string
  rootHandle: FileSystemDirectoryHandle
  onClose: () => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const [closing, setClosing] = useState(false)
  const [readerOpen, setReaderOpen] = useState(false)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.boardId !== boardId) return
      if (event.data.type === "topic-board:request-init") {
        try {
          if (!isNativeReadOnly()) frame.current?.contentWindow?.postMessage({ type: "topic-board:init", boardId, name, rootHandle }, location.origin)
        } catch (reason) { setError(String(reason)) }
      }
      if (event.data.type === "topic-board:ready") { setReady(true); frame.current?.focus() }
      if (event.data.type === "topic-board:closed") onClose()
      if (event.data.type === "topic-board:reader-state") setReaderOpen(event.data.open === true)
      if (event.data.type === "topic-board:error") { setError(event.data.error || "No se pudo guardar la pizarra."); setClosing(false) }
    }
    window.addEventListener("message", receive)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("message", receive)
      previousFocus?.focus({ preventScroll: true })
    }
  }, [boardId, name, rootHandle, onClose])
  const close = () => {
    if (isNativeReadOnly()) { onClose(); return }
    if (!ready) { onClose(); return }
    setClosing(true)
    setError("")
    frame.current?.contentWindow?.postMessage({ type: "topic-board:close", boardId }, location.origin)
  }
  return <div role="dialog" aria-modal="true" aria-label={`Pizarra de ${name}`} className="fixed inset-0 z-[150] flex flex-col bg-white text-slate-900">
    {!readerOpen && <button type="button" aria-label="Volver a Temas" title="Volver a Temas" disabled={closing} onClick={close}
      className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-xl border bg-white text-xl shadow-sm">{closing ? "…" : "←"}</button>}
    {error && <p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
    {!ready && !error && <p role="status" className="px-4 py-2 text-sm text-slate-500">Abriendo pizarra…</p>}
    <iframe ref={frame} title={`Pizarra de ${name}`} src={`/pizarra/?topicBoard=${encodeURIComponent(boardId)}`} className="min-h-0 w-full flex-1 border-0"
      onLoad={() => {
        try {
          if (!isNativeReadOnly()) frame.current?.contentWindow?.postMessage({ type: "topic-board:init", boardId, name, rootHandle }, location.origin)
        } catch (reason) { setError(String(reason)) }
      }} />
  </div>
}
