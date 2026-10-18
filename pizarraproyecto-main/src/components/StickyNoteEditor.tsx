import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { LuCheck, LuX } from 'react-icons/lu'
import { beforeHome } from '../homeNavigation'
import { NOTE_COLORS } from '../canvas/visualObjects'
import type { ShapeItem } from '../canvas/visualObjects'
import './visualTools.css'

export type StickyNoteEditorHandle = { layout: () => void }

export default function StickyNoteEditor({ item, getPlacement, layoutRef, onApply, onClose }: {
  item: ShapeItem
  getPlacement: () => { item: ShapeItem; x: number; y: number; zoom: number }
  layoutRef: Ref<StickyNoteEditorHandle>
  onApply: (base: ShapeItem, next: ShapeItem) => void
  onClose: () => void
}) {
  // Keep the original version for the existing three-way collaboration merge.
  const [base] = useState(() => structuredClone(item))
  const [draft, setDraft] = useState(() => structuredClone(item))
  const root = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const finished = useRef(false)
  const note = draft.note!
  const patch = (value: Partial<typeof note>) => setDraft(old => ({ ...old, note: { ...old.note!, ...value } }))
  const save = () => {
    if (finished.current) return
    if (JSON.stringify(base.note) !== JSON.stringify(draft.note)) onApply(base, draft)
  }
  const apply = () => { if (finished.current) return; save(); finished.current = true; onClose() }
  const cancel = () => { finished.current = true; onClose() }

  function layout() {
    if (!surface.current || !toolbar.current) return
    const { item: current, x, y, zoom } = getPlacement()
    const theta = current.rotation || 0, cx = current.width / 2, cy = current.height / 2
    const dx = cx - (cx * Math.cos(theta) - cy * Math.sin(theta))
    const dy = cy - (cx * Math.sin(theta) + cy * Math.cos(theta))
    Object.assign(surface.current.style, {
      left: `${current.x * zoom + x}px`, top: `${current.y * zoom + y}px`,
      width: `${current.width}px`, height: `${current.height}px`,
      transform: `translate(${dx * zoom}px,${dy * zoom}px) rotate(${theta}rad) scale(${zoom})`,
      visibility: 'visible',
    })
    // Keep controls horizontal, legible and inside the visible area, including a mobile keyboard.
    const viewport = window.visualViewport
    const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8
    const right = left + (viewport?.width ?? innerWidth) - 16
    const bottom = top + (viewport?.height ?? innerHeight) - 16
    toolbar.current.style.maxWidth = `${right - left}px`
    toolbar.current.style.maxHeight = `${bottom - top}px`
    const bounds = surface.current.getBoundingClientRect(), controls = toolbar.current.getBoundingClientRect()
    const below = bounds.bottom + 12
    const preferred = below + controls.height <= bottom ? below : bounds.top - controls.height - 12
    toolbar.current.style.left = `${Math.max(left, Math.min(bounds.left, right - controls.width))}px`
    toolbar.current.style.top = `${Math.max(top, Math.min(preferred, bottom - controls.height))}px`
    toolbar.current.style.visibility = 'visible'
  }

  useImperativeHandle(layoutRef, () => ({ layout }))
  useLayoutEffect(() => { layout() })
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true })
    const end = field.current?.value.length ?? 0
    field.current?.setSelectionRange(end, end)
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(layout)
    if (toolbar.current) observer.observe(toolbar.current)
    window.addEventListener('resize', layout)
    window.visualViewport?.addEventListener('resize', layout)
    window.visualViewport?.addEventListener('scroll', layout)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', layout)
      window.visualViewport?.removeEventListener('resize', layout)
      window.visualViewport?.removeEventListener('scroll', layout)
    }
  })
  useEffect(() => beforeHome(save))
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) apply()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  })

  return <div ref={root} className="inline-note-editor" role="group" aria-label="Editar nota adhesiva"
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply() }
    }}>
    <div ref={surface} className="inline-note-surface" style={{ visibility: 'hidden' }}>
      <textarea ref={field} aria-label="Texto de la nota" placeholder="Escribí una idea…" maxLength={10000}
        value={note.text} onChange={event => patch({ text: event.target.value })}
        style={{ background: note.background, fontSize: note.fontSize }} />
    </div>
    <div ref={toolbar} className="inline-note-toolbar" style={{ visibility: 'hidden' }} aria-label="Opciones de la nota">
      <div className="inline-note-options">
        <input type="number" aria-label="Tamaño de letra de nota" title="Tamaño de letra" min={0.1} step="any"
          value={note.fontSize} onChange={event => {
            const size = Number(event.target.value)
            if (Number.isFinite(size) && size > 0) patch({ fontSize: Math.max(.1, size) })
          }} />
        <div className="visual-swatches" role="group" aria-label="Color de la nota">
          {NOTE_COLORS.map((color, i) => <button type="button" key={color} aria-label={`Color de nota ${i + 1}`}
            aria-pressed={note.background === color} style={{ background: color }} onClick={() => patch({ background: color })} />)}
        </div>
        <button type="button" aria-label="Aplicar" title="Guardar nota (Ctrl+Enter)" onClick={apply}><LuCheck /></button>
        <button type="button" aria-label="Cancelar" title="Cancelar (Escape)" onClick={cancel}><LuX /></button>
      </div>
      {!!note.alternatives?.length && <section className="visual-conflicts" aria-label="Ediciones simultáneas">
        <strong>Otra edición de esta nota</strong><p>Se conservaron ambas versiones. Revisalas antes de resolver.</p>
        {note.alternatives.map((text, i) => <div key={i}><pre>{text || '(texto vacío)'}</pre>
          <button type="button" disabled={note.text.length + text.length + 1 > 10000}
            onClick={() => patch({ text: `${note.text}\n${text}`, alternatives: note.alternatives!.filter((_, n) => n !== i) })}>Conservar ambos textos</button>
          <button type="button" onClick={() => patch({ text, alternatives: [...note.alternatives!.filter((_, n) => n !== i), note.text] })}>Usar esta versión</button>
        </div>)}
        <button type="button" onClick={() => patch({ alternatives: [] })}>Resolver con el texto actual</button>
      </section>}
    </div>
  </div>
}
