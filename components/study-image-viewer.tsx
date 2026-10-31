"use client"

import { useEffect, useRef, useState } from 'react'
import type { Viewer } from 'openseadragon'

export type StudyImage = { id: string; url: string }

export function StudyImageViewer({ images, initialId, onClose }: { images: StudyImage[]; initialId: string; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.id === initialId)))
  const [status, setStatus] = useState('Cargando imagen…')
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
    let active = true, instance: Viewer | undefined
    let objectUrl: string | undefined, settleTimer: ReturnType<typeof setTimeout> | undefined
    let moving = false
    const controller = new AbortController()
    const previewCanvas = preview.current
    setStatus('Cargando imagen…')
    // Fetch only the current image. Both renderers share this local source.
    void (async () => {
      if (!image) return
      const [{ default: OpenSeadragon }, response] = await Promise.all([import('openseadragon'), fetch(image.url, { signal: controller.signal })])
      if (!response.ok) throw new Error('image-load')
      const blob = await response.blob()
      if (!active || !host.current || !preview.current) return
      objectUrl = URL.createObjectURL(blob)
      const original = new Image()
      original.src = objectUrl
      await original.decode()
      if (!active || !host.current || !preview.current) return
      // Rasterize a bounded preview once, including SVG diagrams. During gestures
      // the browser only composites this texture; the original is drawn at rest.
      const thumbnail = preview.current
      const scale = Math.min(1, 2048 / Math.max(original.naturalWidth, original.naturalHeight))
      thumbnail.width = Math.max(1, Math.round(original.naturalWidth * scale))
      thumbnail.height = Math.max(1, Math.round(original.naturalHeight * scale))
      const context = thumbnail.getContext('2d')
      if (!context) throw new Error('preview-canvas')
      context.drawImage(original, 0, 0, thumbnail.width, thumbnail.height)
      original.src = ''

      const positionPreview = () => {
        if (!instance || !instance.world.getItemCount()) return
        const bounds = instance.world.getItemAt(0).getBounds(true)
        const start = instance.viewport.pixelFromPoint(bounds.getTopLeft(), true)
        const end = instance.viewport.pixelFromPoint(bounds.getBottomRight(), true)
        thumbnail.style.transform = `translate3d(${start.x}px,${start.y}px,0) scale(${(end.x - start.x) / thumbnail.width},${(end.y - start.y) / thumbnail.height})`
      }
      const finish = () => {
        if (!active || !instance) return
        moving = false
        instance.forceRedraw()
      }
      const scheduleDetail = () => { clearTimeout(settleTimer); settleTimer = setTimeout(finish, 160) }
      const start = () => {
        if (!instance?.world.getItemCount()) return
        moving = true
        positionPreview()
        thumbnail.style.visibility = 'visible'
        host.current!.style.opacity = '0'
        host.current!.dataset.renderMode = 'preview'
        scheduleDetail()
      }
      // CanvasDrawer's public draw method is missing from the v5 type package.
      const draw = (OpenSeadragon.CanvasDrawer.prototype as unknown as { draw(items: unknown[]): void }).draw
      class DeferredCanvasDrawer extends OpenSeadragon.CanvasDrawer {
        draw(items: unknown[]) {
          if (moving) return
          draw.call(this, items)
          if (active && instance?.world.getItemAt(0)?.getFullyLoaded()) {
            host.current!.style.opacity = '1'
            host.current!.dataset.renderMode = 'detail'
            thumbnail.style.visibility = 'hidden'
          }
        }
      }
      const source = { type: 'image', url: objectUrl, buildPyramid: false }
      instance = OpenSeadragon({
        element: host.current, showNavigationControl: false, showNavigator: false,
        drawer: DeferredCanvasDrawer,
        immediateRender: true, maxImageCacheCount: 12, maxZoomPixelRatio: 4, blendTime: 0,
        animationTime: 0.15, visibilityRatio: 0.8, constrainDuringPan: true,
        tileSources: source,
      })
      instance.setKeyboardNavEnabled(false)
      instance.addHandler('animation-start', start)
      instance.addHandler('canvas-scroll', start)
      instance.addHandler('canvas-drag', start)
      instance.addHandler('canvas-pinch', start)
      instance.addHandler('viewport-change', () => { if (moving) { positionPreview(); scheduleDetail() } })
      instance.addHandler('animation-finish', scheduleDetail)
      instance.addHandler('resize', () => { if (moving) positionPreview() })
      instance.addHandler('open', () => {
        const item = instance!.world.getItemAt(0)
        if (item.getFullyLoaded() && active) setStatus('')
        item.addHandler('fully-loaded-change', event => { if (active && event.fullyLoaded) setStatus('') })
      })
      instance.addHandler('open-failed', () => { if (active) setStatus('No se pudo cargar la imagen. Podés pasar a otra o volver a la pizarra.') })
    })().catch(() => { if (active) setStatus('No se pudo cargar la imagen. Podés pasar a otra o volver a la pizarra.') })
    return () => {
      active = false; controller.abort(); clearTimeout(settleTimer); instance?.destroy()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (previewCanvas) { previewCanvas.width = 0; previewCanvas.height = 0; previewCanvas.style.visibility = 'hidden' }
      if (host.current) { host.current.style.opacity = '1'; delete host.current.dataset.renderMode }
    }
  }, [image?.url, image?.id])

  return <div ref={dialog} role="dialog" aria-modal="true" aria-label="Visor de imágenes de la pizarra" tabIndex={-1}
    style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'white', color: '#0f172a', outline: 'none', overflow: 'hidden' }}>
    <canvas ref={preview} aria-hidden="true" data-study-image-preview style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', willChange: 'transform', visibility: 'hidden', pointerEvents: 'none' }} />
    <div ref={host} data-study-image-viewer style={{ position: 'absolute', inset: 0 }} />
    <button onClick={onClose} aria-label="Volver a la pizarra" title="Volver a la pizarra (Esc)"
      style={{ position: 'absolute', top: 12, left: 12, zIndex: 1, width: 42, height: 42, border: '1px solid #cbd5e1', borderRadius: 10, background: 'white', color: '#0f172a', fontSize: 24, cursor: 'pointer' }}>←</button>
    <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>Imagen {index + 1} de {images.length}</span>
    {status && <p role="status" style={{ position: 'absolute', inset: '40% 16px auto', textAlign: 'center', pointerEvents: 'none' }}>{status}</p>}
  </div>
}
