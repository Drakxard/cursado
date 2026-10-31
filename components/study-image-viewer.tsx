"use client"

import { useEffect, useRef, useState } from 'react'
import type { Viewer } from 'openseadragon'

export type StudyImage = { id: string; url: string }

export function StudyImageViewer({ images, initialId, onClose }: { images: StudyImage[]; initialId: string; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.id === initialId)))
  const [status, setStatus] = useState('Cargando imagen…')
  const host = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null), viewer = useRef<Viewer | null>(null)
  const close = useRef(onClose); close.current = onClose
  const image = images[index]

  useEffect(() => {
    dialog.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      if (['Escape', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (event.key === 'Escape') close.current()
        if (event.key === 'ArrowLeft') setIndex(value => Math.max(0, value - 1))
        if (event.key === 'ArrowRight') setIndex(value => Math.min(images.length - 1, value + 1))
        if (event.key === 'Tab') {
          const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [images.length])

  useEffect(() => {
    let active = true, instance: Viewer | undefined
    setStatus('Cargando imagen…')
    // Only the selected source is opened. Destroying the viewer releases its cache.
    void import('openseadragon').then(({ default: OpenSeadragon }) => {
      if (!active || !host.current || !image) return
      const source = { type: 'image', url: image.url, buildPyramid: false }
      instance = OpenSeadragon({
        element: host.current, showNavigationControl: false, showNavigator: false,
        drawer: 'canvas', crossOriginPolicy: 'Anonymous',
        immediateRender: true, maxImageCacheCount: 32, maxZoomPixelRatio: 4,
        animationTime: 0.25, visibilityRatio: 0.8, constrainDuringPan: true,
        tileSources: source,
      })
      viewer.current = instance
      instance.setKeyboardNavEnabled(false)
      instance.addHandler('open', () => {
        const item = instance!.world.getItemAt(0)
        if (item.getFullyLoaded() && active) setStatus('')
        item.addHandler('fully-loaded-change', event => { if (active && event.fullyLoaded) setStatus('') })
      })
      instance.addHandler('open-failed', () => { if (active) setStatus('No se pudo cargar la imagen. Podés pasar a otra o volver a la pizarra.') })
    }).catch(() => { if (active) setStatus('No se pudo abrir el visor de imágenes.') })
    return () => { active = false; viewer.current = null; instance?.destroy() }
  }, [image?.url, image?.id])

  return <div ref={dialog} role="dialog" aria-modal="true" aria-label="Visor de imágenes de la pizarra" tabIndex={-1}
    style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#0b1120', color: 'white', outline: 'none' }}>
    <div ref={host} data-study-image-viewer style={{ position: 'absolute', inset: 0 }} />
    <button onClick={onClose} aria-label="Volver a la pizarra" title="Volver a la pizarra (Esc)"
      style={{ position: 'absolute', top: 12, left: 12, zIndex: 1, width: 42, height: 42, border: '1px solid #475569', borderRadius: 10, background: '#1e293b', color: 'white', fontSize: 24, cursor: 'pointer' }}>←</button>
    <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>Imagen {index + 1} de {images.length}</span>
    {status && <p role="status" style={{ position: 'absolute', inset: '40% 16px auto', textAlign: 'center', pointerEvents: 'none' }}>{status}</p>}
  </div>
}
