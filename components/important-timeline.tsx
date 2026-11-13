"use client"

import { useState, type PointerEvent } from "react"
import { Button } from "@/components/progress-original/button"
import { Input } from "@/components/progress-original/input"

type TimelineTask = { id: string; text: string; alias?: string; days?: number; numerator: number; denominator: number }
const dayLabel = (day: number) => day === 0 ? "Hoy" : day === 1 ? "Mañana" : `${day} días`

export function ImportantTimeline({ tasks, readOnly, onAlias }: {
  tasks: TimelineTask[]; readOnly: boolean; onAlias: (id: string, alias: string | undefined) => void
}) {
  const [focus, setFocus] = useState<{ segment: number; day: number; position: number } | null>(null)
  const [editor, setEditor] = useState<{ id: string; value: string } | null>(null)
  const groups = new Map<number, TimelineTask[]>([[0, []]])
  for (const task of tasks) {
    const days = task.days ?? Math.max(task.denominator - task.numerator, 0)
    if (days < 0) continue
    groups.set(days, [...(groups.get(days) ?? []), task])
  }
  const points = [...groups].sort(([a], [b]) => a - b)
  const segments = points.length - 1
  const inspect = (event: PointerEvent<HTMLDivElement>) => {
    if (!segments) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    const segment = Math.min(segments - 1, Math.floor(position * segments))
    const start = points[segment][0], end = points[segment + 1][0]
    setFocus({ segment, position, day: end - start })
  }
  if (!tasks.length) return <p role="status" className="py-16 text-center text-muted-foreground">No hay eventos importantes para mostrar.</p>
  return <section aria-label="Línea de eventos importantes" className="overflow-x-auto py-12" data-important-timeline onTouchStart={event => event.stopPropagation()}>
    <div style={{ minWidth: points.length * 220 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`, alignItems: "end", minHeight: 160 }}>
        {points.map(([day, items]) => <div key={day} className="flex flex-col items-center gap-2 px-4 pb-4" data-timeline-group={day}>
          {items.map(task => editor?.id === task.id ? <form key={task.id} className="w-full space-y-2 rounded-lg border bg-card p-2" onSubmit={event => {
            event.preventDefault(); onAlias(task.id, editor.value.trim() || undefined); setEditor(null)
          }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); setEditor(null) } }}>
            <label className="text-sm">Alias de {task.text}
              <Input autoFocus aria-label={`Alias de ${task.text}`} value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} />
            </label>
            <div className="flex flex-wrap gap-1"><Button type="submit" size="sm">Guardar</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditor(null)}>Cancelar</Button></div>
          </form> : <button key={task.id} type="button" disabled={readOnly} title={task.text} className="w-full whitespace-pre-wrap break-words rounded px-1 text-xl text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 disabled:opacity-100" onClick={() => { setFocus(null); setEditor({ id: task.id, value: task.alias ?? "" }) }}>{task.alias || task.text}</button>)}
        </div>)}
      </div>
      <div style={{ marginInline: `${50 / points.length}%`, position: "relative", height: 110 }}>
        <div aria-label="Explorar días intermedios" data-timeline-track className="relative h-8" style={{ touchAction: "pan-y" }}
          onPointerMove={inspect} onPointerDown={event => { if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture(event.pointerId); inspect(event) }}
          onPointerLeave={event => { if (event.pointerType === "mouse") setFocus(null) }} onPointerCancel={() => setFocus(null)}>
          <div className="absolute top-3 h-1.5 w-full rounded-full bg-muted-foreground" style={{ opacity: focus ? 0.25 : 0.6 }} />
          {focus && <div data-timeline-highlight className="absolute top-3 h-1.5 rounded-full bg-orange-500" style={{ left: `${focus.segment / segments * 100}%`, width: `${100 / segments}%` }} />}
          {points.map(([day], index) => <span key={day} className="pointer-events-none absolute top-2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-muted-foreground" style={{ left: `${segments ? index / segments * 100 : 0}%`, opacity: focus ? 0.3 : 0.7 }} />)}
          {focus && <div className="pointer-events-none absolute top-1 -translate-x-1/2" style={{ left: `${focus.position * 100}%` }}>
            <div className="mx-auto h-6 w-0.5 bg-orange-500" />
            <span role="status" data-timeline-day className="absolute left-1/2 top-16 -translate-x-1/2 whitespace-nowrap rounded bg-orange-500 px-2 py-1 text-sm text-white">{focus.day === 1 ? "1 día" : `${focus.day} días`}</span>
          </div>}
        </div>
        {points.map(([day], index) => <span key={day} data-timeline-label={day} className="pointer-events-none absolute top-8 -translate-x-1/2 whitespace-nowrap text-lg text-foreground" style={{ left: `${segments ? index / segments * 100 : 0}%`, opacity: focus ? 0.3 : 1 }}>{dayLabel(day)}</span>)}
      </div>
    </div>
  </section>
}
