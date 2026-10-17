"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useLocalWorkspace } from "@/components/local-workspace-provider"
import { importantTaskProgress, readImportantTasks, writeImportantTasks, type ImportantTask } from "@/lib/important-tasks"

const inputClass = "rounded border border-slate-300 bg-white/80 px-2 py-1 text-sm text-slate-900"
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const editing = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=slider], [role=spinbutton]"))

export function StudyImportantTasks({ children }: { children: ReactNode }) {
  const { rootHandle, isReady } = useLocalWorkspace()
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<ImportantTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [showAverage, setShowAverage] = useState(false)
  const [, refreshDate] = useState(0)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const queue = useRef(Promise.resolve())
  const revision = useRef(0)

  useEffect(() => {
    let active = true
    setLoaded(false)
    setTasks([])
    setError("")
    if (rootHandle && isReady) {
      readImportantTasks(rootHandle).then(value => {
        if (active) { setTasks(value); setLoaded(true) }
      }).catch(reason => { if (active) setError(String(reason)) })
    }
    return () => { active = false }
  }, [rootHandle, isReady])

  useEffect(() => {
    const timer = window.setInterval(() => refreshDate(value => value + 1), 60000)
    const onKey = (event: KeyboardEvent) => {
      if (editing(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return
      if ((!open && event.key === "ArrowRight") || (open && event.key === "ArrowLeft")) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(!open)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => { clearInterval(timer); window.removeEventListener("keydown", onKey, true) }
  }, [open])

  const save = (next: ImportantTask[]) => {
    if (!rootHandle || !loaded) return
    setTasks(next)
    setSaving(true)
    const currentRevision = ++revision.current
    queue.current = queue.current.catch(() => {}).then(async () => {
      try {
        await writeImportantTasks(rootHandle, next)
        if (currentRevision === revision.current) setError("")
      } catch (reason) {
        setError(`No se pudo guardar: ${String(reason)}`)
      } finally {
        if (currentRevision === revision.current) setSaving(false)
      }
    })
  }
  const update = (id: string, values: Partial<ImportantTask>) => save(tasks.map(task => task.id === id ? { ...task, ...values } : task))
  const average = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + importantTaskProgress(task).percentage, 0) / tasks.length) : 0

  return <div
    style={{ touchAction: "pan-y" }}
    onTouchStart={event => {
      if (event.touches.length !== 1 || editing(event.target) || document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) { touch.current = null; return }
      touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }}
    onTouchCancel={() => { touch.current = null }}
    onTouchEnd={event => {
      const start = touch.current
      touch.current = null
      if (!start || !event.changedTouches.length) return
      const dx = event.changedTouches[0].clientX - start.x
      const dy = event.changedTouches[0].clientY - start.y
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (!open && dx > 0) setOpen(true)
        if (open && dx < 0) setOpen(false)
      }
    }}>
    <div hidden={open} inert={open}>{children}</div>
    {open && <section className="min-h-dvh bg-background px-4 py-10 text-foreground" aria-label="Importantes">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-center text-3xl font-bold">Importantes</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">← para volver · En pantalla táctil, deslizá hacia la izquierda</p>
        <div className="mb-4 flex justify-end"><button className="rounded-full bg-purple-600 px-4 py-3 text-sm text-white" onClick={() => setShowAverage(!showAverage)}>Plus + {average}%</button></div>
        <p role="status" className="mb-3 text-sm text-muted-foreground">{saving ? "Guardando…" : error ? "Revisá el error de la carpeta local." : loaded ? "Archivo local: progreso/importantes.json" : "Cargando carpeta local…"}</p>
        {error && <div role="alert" className="mb-4 rounded border border-red-300 p-3 text-sm text-red-600">{error}<button className="ml-3 underline" disabled={!loaded} onClick={() => save(tasks)}>Reintentar guardado</button></div>}
        <div className="space-y-3">{tasks.map(task => {
          const progress = importantTaskProgress(task)
          return <article key={task.id} className="relative overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-green-200 to-green-400 transition-all" style={{ width: `${progress.percentage}%` }} />
            {showAverage && <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-red-500" style={{ left: `${average}%` }} />}
            <div className="relative space-y-3 p-3">
              <div className="flex items-center gap-3">
                <input aria-label="Nombre de la tarea" className={`${inputClass} min-w-0 flex-1`} value={task.text} placeholder="Escribe tu tarea…" onChange={event => update(task.id, { text: event.target.value })} />
                <span className="text-sm text-slate-700">{progress.elapsed}/{progress.total} · {progress.percentage}%</span>
                <button aria-label={`Eliminar ${task.text || "tarea"}`} className="px-2 text-slate-700" onClick={() => save(tasks.filter(item => item.id !== task.id))}>×</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label>Fecha <input type="date" aria-label="Fecha límite" className={inputClass} value={task.dueDate} onChange={event => { if (event.target.value) update(task.id, { dueDate: event.target.value }) }} /></label>
                <span className={`rounded px-2 py-1 font-bold text-white ${progress.remaining <= 2 ? "bg-red-500" : progress.remaining <= 7 ? "bg-orange-500" : "bg-green-600"}`}>{progress.remaining <= 2 ? "🔥" : progress.remaining <= 7 ? "☀️" : "🌲"} {progress.remaining}d</span>
                <input aria-label="Enlace" className={`${inputClass} min-w-0 flex-1`} placeholder="Agregar enlace…" value={task.url} onChange={event => update(task.id, { url: event.target.value })} />
                {task.url.trim() && /^https?:\/\//i.test(task.url.includes(":") ? task.url.trim() : `https://${task.url.trim()}`) && <a className="text-sm underline" href={task.url.includes(":") ? task.url.trim() : `https://${task.url.trim()}`} target="_blank" rel="noopener noreferrer">Abrir</a>}
              </div>
              <div className="flex flex-wrap gap-2">{task.topics.map((topic, index) => <button key={index} title="Quitar tema" className="rounded bg-green-600 px-2 py-1 text-xs text-white" onClick={() => update(task.id, { topics: task.topics.filter((_, i) => i !== index) })}>{topic} ×</button>)}
                <input aria-label="Agregar tema" placeholder="Agregar tema…" className={`${inputClass} w-36`} onKeyDown={event => {
                  if (event.key === "Enter" && event.currentTarget.value.trim()) {
                    update(task.id, { topics: [...task.topics, event.currentTarget.value.trim()] })
                    event.currentTarget.value = ""
                  }
                }} />
              </div>
            </div>
          </article>
        })}</div>
        {loaded && !tasks.length && <p className="py-8 text-center text-muted-foreground">Todavía no hay tareas importantes.</p>}
        <div className="mt-8 text-center"><button disabled={!loaded} className="rounded bg-blue-500 px-5 py-2 text-white disabled:opacity-50" onClick={() => {
          const today = new Date()
          const due = new Date(today)
          due.setDate(due.getDate() + 7)
          save([...tasks, { id: crypto.randomUUID(), text: "", startDate: dateKey(today), dueDate: dateKey(due), url: "", topics: [] }])
        }}>Agregar</button></div>
      </div>
    </section>}
  </div>
}
