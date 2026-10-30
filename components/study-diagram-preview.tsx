'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function StudyDiagramPreview({ url, maximized, onMaximize, onError }: {
  url: string; maximized: boolean; onMaximize: () => void; onError: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [image, setImage] = useState({ width: 1, height: 1 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  const pending = useRef<{ left: number; top: number } | null>(null)
  const points = useRef(new Map<number, { x: number; y: number }>())
  const fit = Math.min(1, Math.max(1, size.width - 32) / image.width, Math.max(1, size.height - 32) / image.height)
  const scale = fit * zoom
  const zoomAt = useRef<(value: number, x?: number, y?: number) => void>(() => {})
  zoomAt.current = (value, x = size.width / 2, y = size.height / 2) => {
    const node = viewport.current
    if (!node) return
    const next = Math.max(.5, Math.min(4 / fit, value))
    const before = fit * zoomRef.current, after = fit * next
    const scroll = pending.current || { left: node.scrollLeft, top: node.scrollTop }
    const left = Math.max(16, (size.width - image.width * before) / 2), top = Math.max(16, (size.height - image.height * before) / 2)
    pending.current = {
      left: (scroll.left + x - left) * after / before + Math.max(16, (size.width - image.width * after) / 2) - x,
      top: (scroll.top + y - top) * after / before + Math.max(16, (size.height - image.height * after) / 2) - y,
    }
    zoomRef.current = next; setZoom(next)
  }
  useLayoutEffect(() => {
    if (pending.current && viewport.current) {
      viewport.current.scrollLeft = pending.current.left; viewport.current.scrollTop = pending.current.top
      pending.current = null
    }
  }, [zoom])
  useEffect(() => {
    const node = viewport.current!
    const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }))
    observer.observe(node)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      zoomAt.current(zoomRef.current * Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top)
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel) }
  }, [])
  function fitImage() { zoomRef.current = 1; pending.current = { left: 0, top: 0 }; setZoom(1); viewport.current?.scrollTo(0, 0) }
  return <div className="study-diagrams-preview-interactive">
    <div className="study-diagrams-preview-tools">
      <button type="button" aria-label="Alejar vista previa" onClick={() => zoomAt.current(zoomRef.current / 1.5)}>−</button>
      <span aria-live="polite">{Math.round(scale * 100)}%</span>
      <button type="button" aria-label="Acercar vista previa" onClick={() => zoomAt.current(zoomRef.current * 1.5)}>+</button>
      <button type="button" onClick={fitImage}>Ajustar</button>
      <button type="button" onClick={() => zoomAt.current(1 / fit)} aria-label="Ver píxeles originales">1:1</button>
      <button type="button" className="study-diagrams-preview-maximize" aria-label={maximized ? 'Restaurar vista previa' : 'Maximizar vista previa'} aria-pressed={maximized} onClick={onMaximize}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{maximized ? <path d="M9 3v6H3m12-6v6h6M3 15h6v6m6 0v-6h6" /> : <path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6" />}</svg>
      </button>
    </div>
    <div ref={viewport} className="study-diagrams-preview-viewport" tabIndex={0} aria-label="Explorar diagrama"
      onKeyDown={event => {
        if (['+', '=', '-','0'].includes(event.key)) {
          event.preventDefault()
          if (event.key === '0') fitImage()
          else zoomAt.current(zoomRef.current * (event.key === '-' ? 1 / 1.5 : 1.5))
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }}
      onPointerMove={event => {
        const old = points.current.get(event.pointerId)
        if (!old) return
        const other = [...points.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
        if (other) {
          const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
          const rect = event.currentTarget.getBoundingClientRect()
          if (before > 0) zoomAt.current(zoomRef.current * after / before, (event.clientX + other.x) / 2 - rect.left, (event.clientY + other.y) / 2 - rect.top)
        } else { event.currentTarget.scrollLeft -= event.clientX - old.x; event.currentTarget.scrollTop -= event.clientY - old.y }
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }}
      onPointerUp={event => points.current.delete(event.pointerId)} onPointerCancel={event => points.current.delete(event.pointerId)} onLostPointerCapture={event => points.current.delete(event.pointerId)}>
      <div style={{ position: 'relative', width: Math.max(size.width, image.width * scale + 32), height: Math.max(size.height, image.height * scale + 32) }}>
        <img src={url} alt="Vista previa de PlantUML" draggable={false} onLoad={event => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={onError}
          style={{ position: 'absolute', left: Math.max(16, (size.width - image.width * scale) / 2), top: Math.max(16, (size.height - image.height * scale) / 2), width: image.width * scale, height: image.height * scale, maxWidth: 'none', maxHeight: 'none' }} />
      </div>
    </div>
  </div>
}
