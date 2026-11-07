// Render the visible crop from the original at screen resolution on every frame.
// Coalesce input bursts without substituting a reduced preview during gestures.
export function createStudyImageCamera(host: HTMLElement, preview: HTMLCanvasElement, detail: HTMLCanvasElement, image: HTMLImageElement) {
  let width = 1, height = 1, scale = 1, x = 0, y = 0, fit = 1
  let frame = 0, disposed = false
  const points = new Map<number, { x: number; y: number }>()
  const bounds = () => host.getBoundingClientRect()
  const paint = () => {
    frame = 0
    if (disposed) return
    const ratio = window.devicePixelRatio || 1
    const pixelWidth = Math.max(1, Math.ceil(width * ratio)), pixelHeight = Math.max(1, Math.ceil(height * ratio))
    if (detail.width !== pixelWidth || detail.height !== pixelHeight) {
      detail.width = pixelWidth; detail.height = pixelHeight
    }
    const ctx = detail.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, detail.width, detail.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Keep the backing canvas bounded by the viewport, including at high zoom.
    const sx = Math.max(0, -x / scale), sy = Math.max(0, -y / scale)
    const ex = Math.min(image.naturalWidth, (width - x) / scale), ey = Math.min(image.naturalHeight, (height - y) / scale)
    if (ex > sx && ey > sy) ctx.drawImage(image, sx, sy, ex - sx, ey - sy,
      (x + sx * scale) * ratio, (y + sy * scale) * ratio, (ex - sx) * scale * ratio, (ey - sy) * scale * ratio)
    detail.style.visibility = 'visible'; preview.style.visibility = 'hidden'
    host.dataset.renderMode = 'detail'
    // Expose the displayed camera for navigation diagnostics.
    detail.dataset.camera = JSON.stringify({ x, y, scale })
  }
  const present = () => {
    if (!frame) frame = requestAnimationFrame(paint)
  }
  const clamp = () => {
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale
    // Retain a visible portion of the image; small drags remain exact at fit.
    x = Math.max(-w + Math.min(w, width) * .2, Math.min(width - Math.min(w, width) * .2, x))
    y = Math.max(-h + Math.min(h, height) * .2, Math.min(height - Math.min(h, height) * .2, y))
  }
  const zoom = (factor: number, px = width / 2, py = height / 2) => {
    const next = Math.max(fit * .5, Math.min(Math.max(4, fit * 4), scale * factor))
    x = px - (px - x) * next / scale; y = py - (py - y) * next / scale; scale = next
    clamp(); present()
  }
  const reset = () => {
    scale = fit; x = (width - image.naturalWidth * scale) / 2; y = (height - image.naturalHeight * scale) / 2
    present()
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault(); event.stopPropagation()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1
    const delta = event.deltaY * unit
    if (!Number.isFinite(delta) || !delta) return
    if (event.ctrlKey || event.metaKey) {
      const rect = bounds()
      zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * .002), event.clientX - rect.left, event.clientY - rect.top)
    } else { y -= delta; clamp(); present() }
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault(); host.setPointerCapture(event.pointerId)
    points.set(event.pointerId, { x: event.clientX, y: event.clientY })
    present()
  }
  const move = (event: PointerEvent) => {
    const old = points.get(event.pointerId)
    if (!old) return
    const other = [...points.entries()].find(([id]) => id !== event.pointerId)?.[1]
    if (other) {
      const before = Math.hypot(old.x - other.x, old.y - other.y), after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      const rect = bounds(), cx = (old.x + other.x) / 2 - rect.left, cy = (old.y + other.y) / 2 - rect.top
      if (before > 0) zoom(after / before, cx, cy)
      x += (event.clientX - old.x) / 2; y += (event.clientY - old.y) / 2
    } else { x += event.clientX - old.x; y += event.clientY - old.y }
    points.set(event.pointerId, { x: event.clientX, y: event.clientY }); clamp(); present()
  }
  const up = (event: PointerEvent) => {
    points.delete(event.pointerId)
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId)
    present()
  }
  const cancel = () => {
    for (const id of points.keys()) if (host.hasPointerCapture(id)) host.releasePointerCapture(id)
    points.clear(); present()
  }
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || !['+', '=', '-', '0'].includes(event.key)) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (event.key === '0') reset(); else zoom(event.key === '-' ? 1 / 1.5 : 1.5)
  }
  const resize = new ResizeObserver(() => {
    const previousWidth = width, previousHeight = height, previousFit = fit
    width = host.clientWidth; height = host.clientHeight
    if (!width || !height) return
    fit = Math.min(width / image.naturalWidth, height / image.naturalHeight)
    if (previousWidth === 1 || Math.abs(scale - previousFit) < .00001) reset()
    else { x += (width - previousWidth) / 2; y += (height - previousHeight) / 2; clamp(); present() }
  })
  host.addEventListener('wheel', wheel, { passive: false })
  host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move)
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up); host.addEventListener('lostpointercapture', up)
  window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true)
  resize.observe(host)
  return () => {
    disposed = true; cancelAnimationFrame(frame); resize.disconnect()
    host.removeEventListener('wheel', wheel); host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move)
    host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('lostpointercapture', up)
    window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true)
    for (const id of points.keys()) if (host.hasPointerCapture(id)) host.releasePointerCapture(id)
    points.clear(); preview.width = preview.height = detail.width = detail.height = 0
  }
}
