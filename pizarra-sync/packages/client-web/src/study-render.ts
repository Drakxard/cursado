import type { TextObject } from '@komuboard/shared'
import { createFormulaEvaluator } from '../../../../pizarraproyecto-main/src/formulas_excel'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SyncedYouTubePlayer } from '../../../../components/study-youtube-player'
import './study-video.css'

const videoRoots = new WeakMap<HTMLElement, Root>()
export function disposeStudy(element: HTMLElement) {
  videoRoots.get(element)?.unmount(); videoRoots.delete(element)
}

// Study cards remain ordinary engine objects: its selection/transform/undo code is reused.
export function paintStudy(el: HTMLElement, obj: TextObject): boolean {
  const study = obj.study
  if (!study) return false
  el.dataset.study = study.kind
  el.style.overflow = 'hidden'
  el.style.background = obj.bg || '#eff6ff'
  el.style.color = '#1e293b'
  el.style.border = '1px solid #94a3b8'
  el.style.borderRadius = '10px'
  if (study.kind === 'youtube' && /^[\w-]{11}$/.test(study.videoId)) {
    let root = videoRoots.get(el)
    if (!root) { el.replaceChildren(); root = createRoot(el); videoRoots.set(el, root) }
    const emit = (detail: Record<string, unknown>) => document.dispatchEvent(new CustomEvent('study-video', { detail: { id: obj.id, ...detail } }))
    const noop = () => {}
    root.render(createElement(SyncedYouTubePlayer, {
      item: { id: obj.id, videoId: study.videoId, x: obj.x, y: obj.y, width: obj.width || 560, height: obj.height || 360, start: study.start || 0, ...(study.end !== undefined ? { end: study.end } : {}) },
      signal: study.signal, connected: true, interactionTool: 'pan',
      onBroadcast: (_id, action, position) => emit({ action, position }),
      onRange: (_id, start, end) => emit({ start, end }), onPointer: noop,
      onInkPointerDown: noop, onInkPointerMove: noop, onInkPointerUp: noop, onInkPointerCancel: noop,
      onSelectPointerDown: noop, onSelectPointerMove: noop, onSelectPointerUp: noop,
    }))
    return true
  }
  disposeStudy(el)
  el.replaceChildren()
  if (study.kind === 'table' && study.table) {
    const table = document.createElement('table')
    table.className = 'study-sheet'
    const caption = table.createCaption(); caption.textContent = study.table.name || 'Tabla'
    const cells = study.table.cells || [], evaluate = createFormulaEvaluator(cells)
    cells.forEach((row: any[], r: number) => {
      const tr = table.insertRow()
      row.forEach((cell: any, c: number) => {
        const td = tr.insertCell(); td.textContent = String(evaluate(r, c)); td.style.backgroundColor = cell.backgroundColor || '#fff'; td.style.color = cell.textColor || '#1f2937'
      })
    })
    el.append(table)
  } else {
    const label = document.createElement('span'); label.textContent = obj.runs.map(run => run.text).join(''); label.className = 'study-card-label'; el.append(label)
  }
  const actions = document.createElement('span'); actions.className = 'study-card-actions'
  const action = (label: string, name: string) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.studyAction = name; button.setAttribute('aria-label', label)
    // Action clicks must not start the canvas's drag gesture or select underlying objects.
    button.addEventListener('pointerdown', event => event.stopPropagation())
    actions.append(button)
  }
  action(study.kind === 'legacy' ? 'Ver original' : study.kind === 'table' ? 'Editar tabla' : 'Abrir', 'open')
  if (study.kind === 'pdf') action(study.pinned ? 'Desfijar PDF' : 'Fijar PDF', 'pin')
  if (study.kind === 'table') el.prepend(actions)
  else el.append(actions)
  return true
}
