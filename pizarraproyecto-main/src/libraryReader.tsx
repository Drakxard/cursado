import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { paintShape } from './canvas/paintShape'
import { visualBounds, pointsBounds, type ShapeItem, type ObjectRef, type TargetGeometry } from './canvas/visualObjects'
import StaticTable, { tableSize, type SheetItem } from './components/StaticTable'
import { GraphPlot, type BoardGraphItem } from './GraphPlot'
import type { Stroke, TextItem, MediaItem } from './storage/database'
import './formas_excel.css'
import './static_tables.css'
import { SubjectHomeCard } from '../../components/subject-home-card'

export function openSubjectsReader(host: HTMLElement, subjects: { id: string; name: string; color: string; detail: string }[], select: (id: string) => void) {
  const root = createRoot(host)
  root.render(createElement('div', { className: 'library-subjects' }, subjects.map(subject => createElement(SubjectHomeCard, { key: subject.id, displayName: subject.name, daysRemainingLabel: subject.detail, color: subject.color, onClick: () => select(subject.id) }))))
  return { close() { root.unmount() } }
}

type Placed<T> = T & { rotation?: number; zIndex?: number }
type Scene = { strokes: Placed<Stroke>[]; texts: Placed<TextItem>[]; media: Placed<MediaItem>[]; shapes?: ShapeItem[]; tables?: Placed<SheetItem>[]; graphs?: Placed<BoardGraphItem>[]; videos?: { x: number; y: number; width: number; height: number; title?: string }[] }
export function openBoardReader(host: HTMLElement, scene: Scene, assetUrl: (id: string) => string) {
  host.replaceChildren(); host.style.cssText = 'position:relative;overflow:hidden;touch-action:none;background:#f6f5ef;min-height:300px'
  const roots: Root[] = [], images = new Map<string, HTMLImageElement>(), layers: { canvas: HTMLCanvasElement; paint: ((ctx: CanvasRenderingContext2D) => void)[] }[] = []
  const dom = document.createElement('div'); dom.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none'; host.append(dom)
  const camera = { x: 0, y: 0, zoom: 1 }
  const shapes = scene.shapes || [], tables = scene.tables || [], graphs = scene.graphs || []
  const resolve = (ref: ObjectRef): TargetGeometry | null => {
    if (ref.kind === 'shape') return shapes.find(s => s.id === ref.id) || null
    if (ref.kind === 'media') return scene.media.find(s => s.id === ref.id) || null
    if (ref.kind === 'graph') return graphs.find(s => s.id === ref.id) || null
    if (ref.kind === 'table') { const t = tables.find(t => t.id === ref.id); return t ? tableSize(t) : null }
    if (ref.kind === 'stroke') { const s = scene.strokes.find(s => s.id === ref.id); return s?.points.length ? pointsBounds(s.points, s.width) : null }
    const t = scene.texts.find(t => t.id === ref.id)
    return t ? { ...t, width: Math.max(...t.text.split('\n').map(l => l.length * t.fontSize * .65), t.fontSize), height: t.text.split('\n').length * t.fontSize * 1.2 } : null
  }
  const boxes: TargetGeometry[] = []
  const renderables: { z: number; paint: (ctx: CanvasRenderingContext2D) => void }[] = []
  for (const item of scene.media || []) {
    boxes.push(item)
    const image = new Image(); images.set(item.id, image); image.onload = () => draw(); image.src = assetUrl(item.assetId)
    renderables.push({ z: item.zIndex ?? -300000, paint: ctx => { if (!image.complete || !image.naturalWidth) return; ctx.save(); ctx.translate(item.x + item.width / 2, item.y + item.height / 2); ctx.rotate(item.rotation || 0); ctx.drawImage(image, -item.width / 2, -item.height / 2, item.width, item.height); ctx.restore() } })
  }
  for (const stroke of scene.strokes || []) {
    if (!stroke.points.length) continue
    boxes.push(pointsBounds(stroke.points, stroke.width))
    renderables.push({ z: stroke.zIndex ?? -100000, paint: ctx => {
      ctx.save(); ctx.strokeStyle = ctx.fillStyle = stroke.color; ctx.lineWidth = Math.max(stroke.width, 1.7 / camera.zoom); ctx.lineCap = ctx.lineJoin = 'round'
      if ((stroke as Stroke & { highlighter?: boolean }).highlighter) ctx.globalAlpha = .3
      ctx.beginPath(); const first = stroke.points[0]
      if (stroke.points.length === 1) { ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill() }
      else { ctx.moveTo(first.x, first.y); for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke() }
      ctx.restore()
    } })
  }
  for (const text of scene.texts || []) {
    const lines = text.text.split('\n'), width = Math.max(text.fontSize, ...lines.map(l => l.length * text.fontSize * .65)), height = lines.length * text.fontSize * 1.2
    boxes.push({ ...text, width, height })
    renderables.push({ z: text.zIndex ?? 0, paint: ctx => { ctx.save(); ctx.translate(text.x + width / 2, text.y + height / 2); ctx.rotate(text.rotation || 0); ctx.translate(-width / 2, -height / 2); ctx.fillStyle = text.color; ctx.font = `${text.fontSize}px system-ui,sans-serif`; ctx.textBaseline = 'top'; lines.forEach((line, i) => ctx.fillText(line, 0, i * text.fontSize * 1.2)); ctx.restore() } })
  }
  for (const shape of shapes) { boxes.push(visualBounds(shape, resolve)); renderables.push({ z: shape.zIndex ?? -200000, paint: ctx => paintShape(ctx, shape, resolve, shape.color, false, 1.35 / camera.zoom) }) }
  const domDepths = [...tables.map(t => t.zIndex ?? 100000), ...graphs.map(g => g.zIndex ?? 200000)].sort((a, b) => a - b)
  const bands = new Map<number, typeof renderables>()
  for (const item of renderables.sort((a, b) => a.z - b.z)) {
    const depth = domDepths.findLast(d => d <= item.z) ?? (domDepths[0] || 0) - 1
    if (!bands.has(depth)) bands.set(depth, [])
    bands.get(depth)!.push(item)
  }
  for (const [depth, items] of bands) {
    const canvas = document.createElement('canvas'); canvas.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${depth * 2 + 1}`
    dom.append(canvas); layers.push({ canvas, paint: items.map(i => i.paint) })
  }
  // z-index belongs to one common scene so DOM tables/graphs and ink interleave.
  dom.style.zIndex = '0'
  for (const table of tables) {
    boxes.push(tableSize(table)); const element = document.createElement('div'); element.style.display = 'contents'; dom.append(element)
    const root = createRoot(element); roots.push(root); root.render(createElement(StaticTable, { table }))
  }
  for (const graph of graphs) {
    boxes.push(graph); const element = document.createElement('div')
    element.style.cssText = `position:absolute;left:${graph.x}px;top:${graph.y}px;width:${graph.width}px;height:${graph.height}px;z-index:${(graph.zIndex ?? 200000) * 2};transform:rotate(${graph.rotation || 0}rad);pointer-events:none`
    dom.append(element); const root = createRoot(element); roots.push(root)
    root.render(createElement(GraphPlot, { formulas: graph.formulas, initialViewport: graph.viewport, settings: graph.settings, graphWidth: graph.width, graphHeight: graph.height }))
  }
  for (const video of scene.videos || []) { boxes.push(video); const label = document.createElement('div'); label.textContent = video.title || 'Video (recurso externo)'; label.style.cssText = `position:absolute;left:${video.x}px;top:${video.y}px;width:${video.width}px;height:${video.height}px;background:#111827;color:white;padding:16px`; dom.append(label) }
  function draw() {
    const width = host.clientWidth, height = host.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2)
    dom.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`
    for (const { canvas, paint } of layers) {
      canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio)
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      canvas.style.transformOrigin = '0 0'
      canvas.style.transform = `translate(${-camera.x / camera.zoom}px,${-camera.y / camera.zoom}px) scale(${1 / camera.zoom})`
      const ctx = canvas.getContext('2d')!; ctx.scale(ratio, ratio); ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom)
      paint.forEach(p => p(ctx))
    }
  }
  function fit() {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const b of boxes) { const padding = b.rotation ? Math.hypot(b.width, b.height) / 2 : 0; left = Math.min(left, b.x - padding); top = Math.min(top, b.y - padding); right = Math.max(right, b.x + b.width + padding); bottom = Math.max(bottom, b.y + b.height + padding) }
    if (!boxes.length) { left = top = 0; right = bottom = 500 }
    camera.zoom = Math.max(.001, Math.min(2, (host.clientWidth - 32) / Math.max(1, right - left), (host.clientHeight - 32) / Math.max(1, bottom - top)))
    camera.x = (host.clientWidth - (right - left) * camera.zoom) / 2 - left * camera.zoom; camera.y = (host.clientHeight - (bottom - top) * camera.zoom) / 2 - top * camera.zoom
    draw()
  }
  const pointers = new Map<number, { x: number; y: number }>()
  function position(event: PointerEvent) { const rect = host.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  function gesture() { const values = [...pointers.values()]; return values.length >= 2 ? { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2, distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) } : { ...(values[0] || { x: 0, y: 0 }), distance: 0 } }
  host.onpointerdown = event => { host.setPointerCapture(event.pointerId); pointers.set(event.pointerId, position(event)) }
  host.onpointermove = event => {
    if (!pointers.has(event.pointerId)) return
    const before = gesture(); pointers.set(event.pointerId, position(event)); const after = gesture(), old = camera.zoom
    if (before.distance > 0) camera.zoom = Math.max(.001, Math.min(20, old * after.distance / before.distance))
    camera.x = after.x - (before.x - camera.x) * camera.zoom / old; camera.y = after.y - (before.y - camera.y) * camera.zoom / old; draw()
  }
  host.onpointerup = host.onpointercancel = event => { pointers.delete(event.pointerId) }
  host.onwheel = event => { event.preventDefault(); const r = host.getBoundingClientRect(), x = event.clientX - r.left, y = event.clientY - r.top, old = camera.zoom; camera.zoom = Math.max(.001, Math.min(20, old * Math.exp(-event.deltaY * .001))); camera.x = x - (x - camera.x) * camera.zoom / old; camera.y = y - (y - camera.y) * camera.zoom / old; draw() }
  const resize = new ResizeObserver(draw); resize.observe(host); fit()
  return { fit, close() { resize.disconnect(); roots.forEach(r => r.unmount()); host.replaceChildren(); host.onpointerdown = host.onpointermove = host.onpointerup = host.onpointercancel = host.onwheel = null } }
}
