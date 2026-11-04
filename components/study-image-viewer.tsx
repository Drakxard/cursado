"use client"

import { useEffect, useRef, useState } from 'react'
import { createStudyImageCamera } from '@/lib/client/study-image-camera'
import { isStudyDocumentImage } from '@/lib/client/study-document-image'

export type StudyImage = { id: string; url: string; document?: boolean }

export function StudyImageViewer({ images, initialId, onClose, theme = 'light', nightImages = 'auto' }: { images: StudyImage[]; initialId: string; onClose: () => void; theme?: string; nightImages?: string }) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.id === initialId)))
  const [status, setStatus] = useState('Cargando imagen…')
  const [documentImage, setDocumentImage] = useState(false)
  const detail = useRef<HTMLCanvasElement>(null)
  const host = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null), preview = useRef<HTMLCanvasElement>(null)
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
    let active = true, objectUrl: string | undefined, dispose: (() => void) | undefined
    const controller = new AbortController(), imageElement = new Image()
    const previewCanvas = preview.current, detailCanvas = detail.current, surface = host.current
    setStatus('Cargando imagen\u2026'); setDocumentImage(false)
    void (async () => {
      if (!image || !surface || !previewCanvas || !detailCanvas) return
      const response = await fetch(image.url, { signal: controller.signal })
      if (!response.ok) throw new Error('image-load')
      const blob = await response.blob()
      if (!active) return
      objectUrl = URL.createObjectURL(blob); imageElement.src = objectUrl
      await imageElement.decode()
      if (!active) return
      const scale = Math.min(1, 2048 / Math.max(imageElement.naturalWidth, imageElement.naturalHeight))
      previewCanvas.width = Math.max(1, Math.round(imageElement.naturalWidth * scale))
      previewCanvas.height = Math.max(1, Math.round(imageElement.naturalHeight * scale))
      const context = previewCanvas.getContext('2d')
      if (!context) throw new Error('preview-canvas')
      context.drawImage(imageElement, 0, 0, previewCanvas.width, previewCanvas.height)
      setDocumentImage(image.document === true || isStudyDocumentImage(previewCanvas))
      dispose = createStudyImageCamera(surface, previewCanvas, detailCanvas, imageElement)
      setStatus('')
    })().catch(() => { if (active) setStatus('No se pudo cargar la imagen. Pod\u00e9s pasar a otra o volver a la pizarra.') })
    return () => {
      active = false; controller.abort(); dispose?.(); imageElement.src = ''
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (previewCanvas) { previewCanvas.width = previewCanvas.height = 0; previewCanvas.style.visibility = 'hidden' }
      if (detailCanvas) { detailCanvas.width = detailCanvas.height = 0; detailCanvas.style.visibility = 'hidden' }
      if (surface) delete surface.dataset.renderMode
    }
  }, [image?.url, image?.id, image?.document])

  const dark = theme === 'dark'
  const invert = dark && (nightImages === 'invert' || (nightImages !== 'original' && documentImage))
  const filter = invert ? 'invert(.9) hue-rotate(180deg)' : 'none'

  return <div ref={dialog} role="dialog" aria-modal="true" aria-label="Visor de imágenes de la pizarra" tabIndex={-1}
    style={{ position: 'fixed', inset: 0, zIndex: 200, background: dark ? '#10141b' : 'white', color: dark ? '#edf0f5' : '#0f172a', colorScheme: dark ? 'dark' : 'light', outline: 'none', overflow: 'hidden' }}>
    <div ref={host} data-study-image-viewer style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'grab', overflow: 'hidden', contain: 'strict' }}>
    <canvas ref={preview} aria-hidden="true" data-study-image-preview style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', willChange: 'transform', filter, visibility: 'hidden', pointerEvents: 'none' }} />
    <canvas ref={detail} data-study-image-detail aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter, visibility: 'hidden', pointerEvents: 'none' }} />
    </div>
    <button onClick={onClose} aria-label="Volver a la pizarra" title="Volver a la pizarra (Esc)"
      style={{ position: 'absolute', top: 12, left: 12, zIndex: 1, width: 42, height: 42, border: '1px solid #cbd5e1', borderRadius: 10, background: dark ? '#191e27' : 'white', color: dark ? '#edf0f5' : '#0f172a', fontSize: 24, cursor: 'pointer' }}>←</button>
    <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>Imagen {index + 1} de {images.length}</span>
    {status && <p role="status" style={{ position: 'absolute', inset: '40% 16px auto', textAlign: 'center', pointerEvents: 'none' }}>{status}</p>}
  </div>
}
