import { useEffect, useRef } from 'react'

export function PdfPinIcon() {
  return <svg width="20" height="25" viewBox="0 0 24 32" fill="currentColor" aria-hidden="true">
    <path d="M3 1h18l-5 10 5 9h-8v9l-2 3V20H3l5-9Z" />
  </svg>
}

export function PinnedPdfButton({ name, onOpen, onReveal }: { name: string; onOpen: () => void; onReveal: () => void }) {
  const gesture = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; handled: boolean } | null>(null)
  const clear = () => { if (gesture.current?.timer) clearTimeout(gesture.current.timer) }
  useEffect(() => clear, [])
  return <button type="button" className="pinned-pdf-button" aria-label={`Abrir PDF fijado ${name}`}
    title={`${name} · Mantener pulsado para ubicar el acceso en la pizarra`}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      if (event.button !== 0) return
      clear()
      const press = { timer: null as ReturnType<typeof setTimeout> | null, x: event.clientX, y: event.clientY, handled: false }
      gesture.current = press
      press.timer = setTimeout(() => { press.timer = null; press.handled = true; onReveal() }, 600)
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const press = gesture.current
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) { clear(); press.handled = true }
    }}
    onPointerUp={clear}
    onPointerCancel={() => { clear(); if (gesture.current) gesture.current.handled = true }}
    onLostPointerCapture={clear}
    onClick={() => {
      if (!gesture.current?.handled) onOpen()
      gesture.current = null
    }}
    onKeyDown={event => {
      if(event.key==='Enter'||event.key===' ')gesture.current=null
      if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); onReveal() }
    }}><PdfPinIcon /></button>
}
