"use client"

import { isNativeReadOnly } from '@/lib/native-workspace'

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react"
import { Button } from "@/components/progress-original/button"
import { Input } from "@/components/progress-original/input"
import { ChevronLeft, ChevronRight, Flame, Sun, TreePine, X, Plus } from "lucide-react"
import { TopicBoardOverlay } from "@/components/topic-board-overlay"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"

function HoldableTaskRow({ children, label, onHold, onHover }: { children: ReactNode; label: string; onHold: () => void; onHover: (hovered: boolean) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }
  useEffect(() => cancel, [])
  return <div className="relative overflow-hidden bg-card border rounded-lg shadow-sm" role="group" aria-label={`Fila ${label}`} tabIndex={0}
    onMouseEnter={() => onHover(true)} onMouseLeave={() => { onHover(false); cancel() }}
    onPointerDown={event => {
      if (isNativeReadOnly()) return
      if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button, input, textarea, select, a, [data-row-activation-stop="true"]')) return
      cancel()
      origin.current = { x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
      timer.current = setTimeout(() => { timer.current = null; onHold() }, 650)
    }}
    onPointerMove={event => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 12) cancel() }}
    onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onContextMenu={event => { if (!(event.target as Element).closest('button, input, textarea, select, a, [data-row-activation-stop="true"]')) event.preventDefault() }}
    onKeyDown={event => {
      if (isNativeReadOnly()) return
      if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return
      event.preventDefault()
      if (!event.repeat) { cancel(); timer.current = setTimeout(() => { timer.current = null; onHold() }, 650) }
    }}
    onKeyUp={event => { if (event.target === event.currentTarget) cancel() }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) cancel() }}
  >{children}</div>
}

function CalendarGestures({ children, onMonthChange }: { children: ReactNode; onMonthChange: (direction: number) => void }) {
  const surface = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => {
    const element = surface.current
    if (!element) return
    let lastChange = -Infinity
    let delta = 0
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastChange < 250) return
      const movement = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      if (Math.sign(movement) !== Math.sign(delta)) delta = 0
      delta += movement
      if (Math.abs(delta) < 40) return
      onMonthChange(Math.sign(delta))
      delta = 0
      lastChange = now
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [onMonthChange])
  return <div ref={surface} data-calendar-gestures className="bg-card p-4 rounded-lg shadow-lg w-full max-w-3xl" style={{ touchAction: "pan-y" }}
    onTouchStart={event => {
      event.stopPropagation()
      suppressClick.current = false
      start.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null
    }}
    onTouchCancel={event => { event.stopPropagation(); start.current = null }}
    onTouchEnd={event => {
      event.stopPropagation()
      const origin = start.current
      start.current = null
      if (!origin || !event.changedTouches.length) return
      const dx = event.changedTouches[0].clientX - origin.x
      const dy = event.changedTouches[0].clientY - origin.y
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        suppressClick.current = true
        onMonthChange(dx < 0 ? 1 : -1)
      }
    }}
    onClickCapture={event => {
      if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
    }}
  >{children}</div>
}

function TopicChip({ topic, onRemove, onOpen }: { topic: string; onRemove: () => void; onOpen: () => void }) {
  const held = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])
  return <button
    type="button"
    title="Abrir pizarra · Mantené presionado para borrar"
    aria-label={`Tema ${topic}. Abrir pizarra. Mantener presionado para borrar`}
    className="flex min-h-[4.5rem] min-w-0 items-center justify-center break-words rounded-[1.25rem] bg-green-500 px-4 py-3 text-center text-[1.75rem] leading-tight text-white cursor-pointer select-none touch-pan-y transition-colors hover:bg-green-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    data-row-activation-stop="true"
    onPointerDown={event => {
      if (isNativeReadOnly()) return
      if (!event.isPrimary || event.button !== 0) return
      cancel()
      held.current = false
      origin.current = { x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
      timer.current = setTimeout(() => { timer.current = null; held.current = true; onRemove() }, 650)
    }}
    onPointerMove={event => {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 12) cancel()
    }}
    onPointerUp={cancel}
    onPointerCancel={cancel}
    onLostPointerCapture={cancel}
    onClick={() => { if (!held.current) onOpen() }}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (isNativeReadOnly()) return
      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
        event.preventDefault()
        cancel()
        held.current = false
        timer.current = setTimeout(() => { timer.current = null; held.current = true; onRemove() }, 650)
      }
    }}
    onKeyUp={event => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault()
        const wasPending = timer.current !== null
        cancel()
        if (wasPending && !held.current) onOpen()
      }
    }}
    onBlur={cancel}
  >{topic}</button>
}

const parseDateInput = (input?: string): Date | null => {
  if (!input) return null
  if (/^\d+d$/.test(input)) {
    const days = parseInt(input.slice(0, -1), 10)
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-").map(Number)
    return new Date(year, month - 1, day)
  }
  const date = new Date(input)
  if (isNaN(date.getTime())) {
    return null
  }
  if (/[zZ]$/.test(input) || /[+-]\d{2}:\d{2}$/.test(input)) {
    return new Date(date.getTime() + date.getTimezoneOffset() * 60000)
  }
  return date
}

const normalizeDate = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const computeDaysUntil = (targetDate: Date) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const normalizedSelected = normalizeDate(targetDate)
  const diffMs = normalizedSelected.getTime() - today.getTime()
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

const normalizeUrlForOpen = (url?: string) => {
  if (!url) return ""
  const trimmed = url.trim()
  if (!trimmed) return ""
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const formatDateForStorage = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const ABSOLUTE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:$|T)/

const rollDateForwardWeekly = (date: Date, today: Date) => {
  let nextDate = normalizeDate(date)
  while (nextDate <= today) {
    nextDate = normalizeDate(
      new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate() + 7),
    )
  }
  return nextDate
}

const SUBJECT_RESOURCE_LINKS: Record<string, { theory?: string; practice?: string }> = {
  Álgebra: {
    theory: "https://v0-pdf-navigation-app.vercel.app/teoria/algebra",
    practice: "https://v0-pdf-navigation-app.vercel.app/practica/algebra",
  },
  Cálculo: {
    theory: "https://v0-pdf-navigation-app.vercel.app/teoria/calculo",
    practice: "https://v0-pdf-navigation-app.vercel.app/practica/calculo",
  },
  Poo: {
    theory: "https://v0-pdf-navigation-app.vercel.app/teoria/poo",
    practice: "https://v0-pdf-navigation-app.vercel.app/práctica/poo",
  },
}

interface CalendarEvent {
  date: Date
  label: string
  color: string
  url?: string
  source?: {
    kind: "important" | "theory" | "practice"
    taskId?: string
    tableIndex?: number
  }
}

interface TaskItem {
  id: string
  text: string
  numerator: number
  denominator: number
  days?: number
  topics?: string[]
  topicBoardIds?: string[]
  url?: string
}

function compareTaskDaysRemaining(a: TaskItem, b: TaskItem) {
  return (a.days ?? Math.max(a.denominator - a.numerator, 0)) -
    (b.days ?? Math.max(b.denominator - b.numerator, 0))
}

interface Table {
  title: string
  tasks: TaskItem[]
}

import { importantTaskProgress, readImportantTasks, writeImportantTasks, type ImportantTask } from "@/lib/important-tasks"
import { useLocalWorkspace } from "@/components/local-workspace-provider"

// UI copied from progreso/components/progress-tracker.tsx; only local persistence and study navigation are adapted.
export default function ImportantProgressView({ active, onBack }: { active: boolean; onBack: () => void }) {
  const currentTableIndex = 0
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const isTransitioning = false
  const [showAverageLine, setShowAverageLine] = useState(false)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [topicInputs, setTopicInputs] = useState<Record<string, string>>({})
  const [addingTopicId, setAddingTopicId] = useState<string | null>(null)
  const [selectedTopicBoard, setSelectedTopicBoard] = useState<{ boardId: string; name: string } | null>(null)
  const closeTopicBoard = useCallback(() => setSelectedTopicBoard(null), [])
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "task"; taskId: string; label: string } |
    { kind: "topic"; taskId: string; boardId: string; label: string } | null
  >(null)
 
  const [isEventMode, setIsEventMode] = useState(false)
  const [eventTasks, setEventTasks] = useState<
    { task: TaskItem; tableTitle: string; tableIndex: number; daysRemaining: number }[]
  >([])
  const [eventIndex, setEventIndex] = useState(0)
  const [eventZoom, setEventZoom] = useState(2)
  const [isCalendarMode, setIsCalendarMode] = useState(false)
  const [calendarDate, setCalendarDate] = useState(new Date())
  const moveCalendarMonth = useCallback((direction: number) => {
    setCalendarDate(prev => new Date(prev.getFullYear(), prev.getMonth() + direction, 1))
  }, [])
  const [calendarSelection, setCalendarSelection] = useState<
    { taskId: string; tableIndex: number } | null
  >(null)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  )


  const { rootHandle, isReady } = useLocalWorkspace()
  const [tables, setTables] = useState<Table[]>([{ title: "Importantes", tasks: [] }])
  const [storageError, setStorageError] = useState("")
  const subjectSchedules: { name: string; theoryDate?: string; practiceDate?: string }[] = []
  const queue = useRef(Promise.resolve())
  const loaded = useRef(false)
  useEffect(() => {
    let active = true
    loaded.current = false
    setIsLoading(true)
    if (rootHandle && isReady) readImportantTasks(rootHandle).then(tasks => {
      if (!active) return
      setTables([{ title: "Importantes", tasks: tasks.map(task => {
        const progress = importantTaskProgress(task)
        return { id: task.id, text: task.text, numerator: progress.elapsed, denominator: progress.total, days: progress.remaining, url: task.url, topics: task.topics, topicBoardIds: task.topicBoardIds ?? task.topics.map(() => crypto.randomUUID()) }
      }).sort(compareTaskDaysRemaining) }])
      loaded.current = true
      setIsLoading(false)
    }).catch(error => { if (active) { setStorageError(String(error)); setIsLoading(false) } })
    return () => { active = false }
  }, [rootHandle, isReady])
  useEffect(() => {
    if (!active || !loaded.current) return
    setTables(previous => {
      const tasks = [...previous[0].tasks].sort(compareTaskDaysRemaining)
      if (tasks.every((task, index) => task === previous[0].tasks[index])) return previous
      return [{ ...previous[0], tasks }]
    })
  }, [active])
  useEffect(() => {
    if (isNativeReadOnly() || !loaded.current || !rootHandle) return
    const today = normalizeDate(new Date())
    const tasks = tables[0].tasks.map(task => {
      const due = new Date(today)
      due.setDate(due.getDate() + (task.days ?? task.denominator - task.numerator))
      const start = new Date(due)
      start.setDate(start.getDate() - task.denominator)
      return { id: task.id, text: task.text, startDate: formatDateForStorage(start), dueDate: formatDateForStorage(due), url: task.url ?? "", topics: task.topics ?? [], topicBoardIds: task.topicBoardIds ?? [] }
    })
    queue.current = queue.current.catch(() => {}).then(() => writeImportantTasks(rootHandle, tasks)).then(() => setStorageError("")).catch(error => setStorageError(String(error)))
  }, [tables, rootHandle])
  const changeTask = (id: string, patch: Partial<TaskItem>) => { if (!isNativeReadOnly()) setTables(prev => [{ ...prev[0], tasks: prev[0].tasks.map(task => task.id === id ? { ...task, ...patch } : task) }]) }
  const saveTask = async (id: string) => { changeTask(id, { text: editText }); setEditingId(null); setEditText("") }
  const addImportantTask = () => setTables(prev => [{ ...prev[0], tasks: [...prev[0].tasks, { id: crypto.randomUUID(), text: "", days: 7, numerator: 0, denominator: 7, topics: [] }] }])
  const removeImportantTask = (id: string) => setTables(prev => [{ ...prev[0], tasks: prev[0].tasks.filter(task => task.id !== id) }])
  const addTopic = (id: string, topic: string) => {
    if (topic.trim()) setTables(prev => [{ ...prev[0], tasks: prev[0].tasks.map(task => task.id === id ? { ...task, topics: [...(task.topics ?? []), topic.trim()], topicBoardIds: [...(task.topicBoardIds ?? []), crypto.randomUUID()] } : task) }])
  }
  const removeTopic = (id: string, index: number) => setTables(prev => [{ ...prev[0], tasks: prev[0].tasks.map(task => task.id === id ? { ...task, topics: (task.topics ?? []).filter((_, i) => i !== index), topicBoardIds: (task.topicBoardIds ?? []).filter((_, i) => i !== index) } : task) }])
  const handleCalendarDateSelection = async (date: Date) => {
    if (!calendarSelection) return
    const task = tables[0].tasks.find(task => task.id === calendarSelection.taskId)
    if (!task) return
    const days = computeDaysUntil(date)
    const denominator = Math.max(task.denominator, days, 1)
    changeTask(task.id, { days, denominator, numerator: denominator - days })
    setCalendarSelection(null)
    setIsCalendarMode(false)
  }
  const calendarEvents = useMemo(() => {
    const events: CalendarEvent[] = []

    const importantTableIndex = 0
    const importantTasks = tables[0].tasks
    const today = new Date()
    importantTasks.forEach((task) => {
      if (task.days !== undefined && task.days >= 0) {
        const due = new Date(today)
        due.setDate(due.getDate() + (task.days || 0))
        events.push({
          date: due,
          label: `${task.text} (${task.days}d)`,
          color: "bg-orange-500",
          source: {
            kind: "important",
            taskId: task.id,
            tableIndex: importantTableIndex,
          },
        })
      }
    })

    return events
  }, [tables])

  const selectedCalendarTask = useMemo(() => {
    if (!calendarSelection) return null
    const table = tables[calendarSelection.tableIndex]
    if (!table) return null
    const task = table.tasks.find((t) => t.id === calendarSelection.taskId)
    if (!task) return null

    let dueDate: Date | null = null
    if (table.title === "Importantes" && typeof task.days === "number") {
      const base = new Date()
      base.setHours(0, 0, 0, 0)
      base.setDate(base.getDate() + task.days)
      dueDate = base
    } else if (table.title === "Teoría" || table.title === "Práctica") {
      const subject = subjectSchedules.find((item) => item.name === task.text)
      if (subject) {
        const rawDate =
          table.title === "Teoría" ? subject.theoryDate : subject.practiceDate
        const parsedDate = parseDateInput(rawDate)
        if (parsedDate) {
          dueDate = parsedDate
        }
      }
    }

    return {
      task,
      tableTitle: table.title,
      dueDate,
    }
  }, [calendarSelection, tables, subjectSchedules])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!active || selectedTopicBoard || deleteTarget) return
      if (event.altKey || event.metaKey) return
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]")) return
      if (event.key.toLowerCase() === "c" && !editingId) {
        event.preventDefault()
        setCalendarSelection(null)
        setIsCalendarMode((prev) => !prev)
        return
      }
      if (isCalendarMode) {
        if (event.key === "Escape") {
          event.preventDefault()
          setCalendarSelection(null)
          setIsCalendarMode(false)
          return
        }
        if (event.key === "ArrowRight") {
          event.preventDefault()
          setCalendarDate(
            (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
          )
        } else if (event.key === "ArrowLeft") {
          event.preventDefault()
          setCalendarDate(
            (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
          )
        }
        return
      }
      if (event.key.toLowerCase() === "i" && !editingId) {
        event.preventDefault()
        if (isEventMode) {
          setIsEventMode(false)
        } else {
          const tasks = tables
            .flatMap((table, tableIndex) =>
              table.tasks.map((task) => ({
                task,
                tableTitle: table.title,
                tableIndex,
                daysRemaining:
                  typeof task.days === "number"
                    ? task.days
                    : Math.max(task.denominator - task.numerator, 0),
              })),
            )
            .sort((a, b) => a.daysRemaining - b.daysRemaining)
          setEventTasks(tasks)
          setEventIndex(0)
          setIsEventMode(true)
        }
        return
      }
      if (isEventMode) {
        if (event.ctrlKey && (event.key === "+" || event.key === "=")) {
          event.preventDefault()
          setEventZoom((prev) => Math.min(prev + 0.1, 3))
        } else if (event.ctrlKey && (event.key === "-" || event.key === "_")) {
          event.preventDefault()
          setEventZoom((prev) => Math.max(prev - 0.1, 0.5))
        } else if (event.ctrlKey && event.key === "0") {
          event.preventDefault()
          setEventZoom(2)
        } else if (event.key === "ArrowRight") {
          event.preventDefault()
          setEventIndex((prev) =>
            eventTasks.length ? (prev + 1) % eventTasks.length : 0,
          )
        } else if (event.key === "ArrowLeft") {
          event.preventDefault()
          setEventIndex((prev) =>
            eventTasks.length
              ? (prev - 1 + eventTasks.length) % eventTasks.length
              : 0,
          )
        }
        return
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        onBack()
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isEventMode, editingId, tables, eventTasks, isCalendarMode, onBack, active, selectedTopicBoard, deleteTarget])

  const currentTable = tables[currentTableIndex]
  const getProgressPercentage = (numerator: number, denominator: number) => {
    if (denominator === 0) return 0
    return Math.min((numerator / denominator) * 100, 100)
  }

  const calculateAveragePercentage = () => {
    const currentTasks = currentTable.tasks
    const totalPercentage = currentTasks.reduce((sum, task) => {
      return sum + getProgressPercentage(task.numerator, task.denominator)
    }, 0)
    return currentTasks.length ? Math.round(totalPercentage / currentTasks.length) : 0
  }

  const calculatePdfsNeeded = (task: TaskItem) => {
    const currentTasks = currentTable.tasks
    const currentPercentage = getProgressPercentage(task.numerator, task.denominator)

    // Calcular la media actual
    const currentAverage = calculateAveragePercentage()

    if (currentPercentage >= currentAverage) return 0

    let pdfsNeeded = 0
    let testNumerator = task.numerator

    while (pdfsNeeded < task.denominator) {
      testNumerator = task.numerator + pdfsNeeded

      const newTotalPercentage = currentTasks.reduce((sum, t) => {
        if (t.id === task.id) {
          return sum + getProgressPercentage(testNumerator, t.denominator)
        }
        return sum + getProgressPercentage(t.numerator, t.denominator)
      }, 0)

      const newAverage = newTotalPercentage / currentTasks.length
      const newTaskPercentage = getProgressPercentage(testNumerator, task.denominator)

      if (newTaskPercentage >= newAverage) {
        break
      }

      pdfsNeeded++
    }

    return pdfsNeeded
  }

  const getIconAndColor = (daysRemaining: number) => {
    if (daysRemaining === 1) {
      return {
        icon: Flame,
        bgColor: "from-orange-500 to-red-500",
        iconColor: "text-yellow-200",
      }
    } else if (daysRemaining >= 3) {
      return {
        icon: TreePine,
        bgColor: "from-green-500 to-emerald-600",
        iconColor: "text-green-100",
      }
    } else {
      return {
        icon: Sun,
        bgColor: "from-yellow-400 to-orange-400",
        iconColor: "text-yellow-100",
      }
    }
  }

  const renderCalendarCells = () => {
    const year = calendarDate.getFullYear()
    const month = calendarDate.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startDay = new Date(year, month, 1).getDay()
    const cells = []
    const today = new Date()
    const selectedDate = selectedCalendarTask?.dueDate || null
    const isSelectingDate = Boolean(calendarSelection)

    for (let i = 0; i < startDay; i++) {
      cells.push(<div key={`empty-${i}`} />)
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = calendarEvents.filter(
        (e) =>
          e.date.getFullYear() === year &&
          e.date.getMonth() === month &&
          e.date.getDate() === day,
      )
      const isToday =
        year === today.getFullYear() &&
        month === today.getMonth() &&
        day === today.getDate()
      const isSelected =
        selectedDate !== null &&
        selectedDate.getFullYear() === year &&
        selectedDate.getMonth() === month &&
        selectedDate.getDate() === day

      cells.push(
        <button
          type="button"
          key={day}
          onClick={() => {
            if (isSelectingDate) {
              void handleCalendarDateSelection(new Date(year, month, day))
            }
          }}
          className={`border h-24 p-1 overflow-hidden text-left transition-colors ${
            isToday ? "bg-blue-200 dark:bg-blue-900" : ""
          } ${isSelected ? "ring-2 ring-blue-500" : ""} ${
            isSelectingDate ? "cursor-pointer hover:border-blue-500" : "cursor-default"
          }`}
        >
          <div className="text-[10px] font-bold">{day}</div>
          <div className="space-y-1 mt-1">
            {dayEvents.map((ev, idx) => (
              <div
                key={idx}
                className={`text-[9px] text-white px-1 rounded ${ev.color}`}
              >
                {ev.label}
              </div>
            ))}
          </div>
        </button>,
      )
    }
    return cells
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Cargando progreso...</p>
        </div>
      </div>
    )
  }

  if (isCalendarMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <CalendarGestures onMonthChange={moveCalendarMonth}>
          <div className="flex items-center justify-between mb-4 gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setCalendarDate(
                  (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                )
              }
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 text-center">
              <h2 className="text-xl font-bold capitalize">
                {calendarDate.toLocaleString("es-ES", { month: "long" })}{" "}
                {calendarDate.getFullYear()}
              </h2>
              {calendarSelection && selectedCalendarTask && (
                <p className="text-xs text-muted-foreground mt-1">
                  Selecciona la fecha del evento para {" "}
                  <span className="font-semibold">
                    {selectedCalendarTask.task.text}
                  </span>
                  {selectedCalendarTask.tableTitle
                    ? ` (${selectedCalendarTask.tableTitle})`
                    : ""}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setCalendarDate(
                    (prev) =>
                      new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                  )
                }
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setCalendarSelection(null)
                  setIsCalendarMode(false)
                }}
                aria-label="Cerrar calendario"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2 text-xs text-center mb-2">
            {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => (
              <div key={d} className="font-semibold">
                {d}
              </div>
            ))}
            {renderCalendarCells()}
          </div>
          {calendarSelection && (
            <p className="text-xs text-muted-foreground text-center">
              Haz clic en una fecha para asignar los días restantes de este evento.
            </p>
          )}
        </CalendarGestures>
      </div>
    )
  }

  if (isEventMode && eventTasks.length > 0) {
    const current = eventTasks[eventIndex]
    const { task, tableTitle, tableIndex, daysRemaining } = current
    const { icon: IconComponent, bgColor, iconColor } = getIconAndColor(daysRemaining)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div
          className={`relative overflow-hidden bg-card border rounded-lg shadow-sm w-full max-w-md`}
          style={{ transform: `scale(${eventZoom})`, transformOrigin: "center" }}
        >
          <div
            className={`absolute top-0 right-0 z-20 flex items-center gap-1 bg-gradient-to-r ${bgColor} text-white px-2 py-1 rounded-bl-lg text-xs font-bold shadow-lg`}
          >
            <IconComponent className={`h-3 w-3 ${iconColor}`} />
            <span>{daysRemaining}d</span>
          </div>

          <div
            className="absolute inset-0 bg-gradient-to-r from-green-200 to-green-400 transition-all duration-300 ease-out"
            style={{ width: `${getProgressPercentage(task.numerator, task.denominator)}%` }}
          />

          <div className="relative z-10 flex items-center gap-4 p-6">
            <div className="flex-1 p-3 text-foreground">{task.text}</div>
            <div className="text-sm text-muted-foreground font-medium shrink-0 w-12 text-right">
              {Math.round(getProgressPercentage(task.numerator, task.denominator))}%
            </div>
          </div>
          <div className="absolute bottom-2 left-3 text-xs text-muted-foreground">
            {tableTitle}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-6 relative">
      {selectedTopicBoard && rootHandle && <TopicBoardOverlay {...selectedTopicBoard} rootHandle={rootHandle} onClose={closeTopicBoard} />}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent className="progress-original">
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget?.kind === "task" ? "¿Borrar esta fila?" : "¿Borrar este tema?"}</AlertDialogTitle>
            <AlertDialogDescription>{deleteTarget?.label || "Sin nombre"}{deleteTarget?.kind === "task" ? ". Se quitarán la fila y sus temas." : ". Se quitará el tema de esta fila."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!deleteTarget) return
              if (deleteTarget.kind === "task") removeImportantTask(deleteTarget.taskId)
              else {
                const task = tables[0].tasks.find(task => task.id === deleteTarget.taskId)
                const index = task?.topicBoardIds?.indexOf(deleteTarget.boardId) ?? -1
                if (index >= 0) removeTopic(deleteTarget.taskId, index)
              }
              setDeleteTarget(null)
            }}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {storageError && <p role="alert" className="text-red-600">{storageError}</p>}
      <div className="fixed top-6 right-6 z-30">
        <Button
          onClick={() => setShowAverageLine(!showAverageLine)}
          className="w-16 h-16 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
          size="lg"
        >
          <div className="flex flex-col items-center">
            <span className="text-xs text-white font-bold">Plus +</span>
            <span className="text-xs text-white font-bold">{calculateAveragePercentage()}%</span>
          </div>
        </Button>
      </div>

      <div className="max-w-4xl mx-auto">
        <h1
          className={`text-3xl font-bold mb-8 text-center transition-all duration-300 ${isTransitioning ? "opacity-0 transform scale-95" : "opacity-100 transform scale-100"}`}
        >
          {currentTable.title}
        </h1>

        <div
          className={`space-y-3 transition-all duration-300 ${isTransitioning ? "opacity-0 transform translate-x-4" : "opacity-100 transform translate-x-0"}`}
        >
          {currentTable.tasks.map((task) => {
            const daysRemaining =
              typeof task.days === "number"
                ? task.days
                : Math.max(task.denominator - task.numerator, 0)
            const { icon: IconComponent, bgColor, iconColor } = getIconAndColor(daysRemaining)
            const currentPercentage = getProgressPercentage(task.numerator, task.denominator)
            const averagePercentage = calculateAveragePercentage()
            const isBelowAverage = currentPercentage < averagePercentage
            const isHovered = hoveredTaskId === task.id
            const missingPdfs = calculatePdfsNeeded(task)
            return (
              <HoldableTaskRow
                key={task.id}
                label={task.text || "Sin nombre"}
                onHold={() => setDeleteTarget({ kind: "task", taskId: task.id, label: task.text })}
                onHover={hovered => setHoveredTaskId(hovered ? task.id : null)}
              >
                <div
                  className={`absolute top-0 right-0 z-20 flex items-center gap-1 bg-gradient-to-r ${bgColor} text-white px-2 py-1 rounded-bl-lg text-xs font-bold shadow-lg cursor-pointer`}
                  data-row-activation-stop="true"
                  onClick={() => {
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    let initialDate = new Date(
                      today.getFullYear(),
                      today.getMonth(),
                      1,
                    )

                    if (currentTable.title === "Importantes") {
                      if (typeof task.days === "number") {
                        const dueDate = new Date(today)
                        dueDate.setDate(dueDate.getDate() + task.days)
                        initialDate = new Date(
                          dueDate.getFullYear(),
                          dueDate.getMonth(),
                          1,
                        )
                      }
                    } else {
                      const subject = subjectSchedules.find(
                        (item) => item.name === task.text,
                      )
                      const rawDate =
                        currentTable.title === "Teoría"
                          ? subject?.theoryDate
                          : subject?.practiceDate
                      const parsedDate = parseDateInput(rawDate)
                      if (parsedDate) {
                        initialDate = new Date(
                          parsedDate.getFullYear(),
                          parsedDate.getMonth(),
                          1,
                        )
                      }
                    }

                    setCalendarDate(initialDate)
                    setCalendarSelection({
                      taskId: task.id,
                      tableIndex: currentTableIndex,
                    })
                    setIsCalendarMode(true)
                  }}
                >
                  <IconComponent className={`h-3 w-3 ${iconColor}`} />
                  <span>{daysRemaining}d</span>
                </div>

                <div
                  className="absolute inset-0 bg-gradient-to-r from-green-200 to-green-400 transition-all duration-300 ease-out"
                  style={{
                    width: `${getProgressPercentage(task.numerator, task.denominator)}%`,
                  }}
                />

                {showAverageLine && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 z-15 shadow-sm transition-all duration-300"
                    style={{
                      left: `${calculateAveragePercentage()}%`,
                      background:
                        showAverageLine && isHovered && isBelowAverage
                          ? "linear-gradient(to bottom, #374151 0%, #374151 100%)"
                          : "repeating-linear-gradient(to bottom, #ef4444 0px, #ef4444 4px, transparent 4px, transparent 8px)",
                    }}
                  >
                    {showAverageLine && isHovered && isBelowAverage && (
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-gradient-radial from-white via-gray-200 to-gray-800 flex items-center justify-center shadow-lg z-30">
                        <div className="text-center">
                          <div className="text-xs font-bold text-gray-800">Faltan</div>
                          <div className="text-sm font-bold text-gray-900">{missingPdfs} pdfs</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="relative z-10 grid min-h-[6.5rem] grid-cols-1 gap-3 p-3 pr-6 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] sm:items-center sm:gap-5 sm:pr-16">
                  <div className="flex min-w-0 flex-col items-start gap-2">
                  <div className="flex-1">
                    {editingId === task.id ? (
                      <Input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            saveTask(task.id)
                          }
                        }}
                        onBlur={() => saveTask(task.id)}
                        placeholder="Escribe tu tarea..."
                        className="bg-transparent border-none shadow-none focus-visible:ring-0 w-auto min-w-[8rem]"
                        data-row-activation-stop="true"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="inline-flex min-h-[2.5rem] items-center rounded px-2 text-left text-foreground transition-colors hover:text-muted-foreground"
                        data-row-activation-stop="true"
                        onClick={(event) => {
                          if (isNativeReadOnly()) return
                          event.preventDefault()
                          setEditingId(task.id)
                          setEditText(task.text)
                        }}
                      >
                        <span className="whitespace-pre-wrap">{task.text || "Haz clic para escribir..."}</span>
                      </button>
                    )}
                  </div>

                  {addingTopicId === task.id ? <Input
                    autoFocus
                    value={topicInputs[task.id] || ""}
                    onChange={(e) =>
                      setTopicInputs((prev) => ({ ...prev, [task.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addTopic(task.id, topicInputs[task.id] || "")
                        setTopicInputs((prev) => ({ ...prev, [task.id]: "" }))
                        setAddingTopicId(null)
                      }
                      if (e.key === "Escape") setAddingTopicId(null)
                    }}
                    onBlur={() => setAddingTopicId(null)}
                    placeholder="Agregar tema..."
                    className="w-32 h-7 bg-white/80 backdrop-blur-sm text-xs"
                    data-row-activation-stop="true"
                  /> : <button data-workspace-write={isNativeReadOnly() || undefined}
                    type="button"
                    aria-label="Agregar tema"
                    title="Agregar tema"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    data-row-activation-stop="true"
                    onClick={() => setAddingTopicId(task.id)}
                  ><Plus className="h-4 w-4" /></button>}
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
                  {(task.topics || []).map((topic, index) => (
                    <TopicChip key={task.topicBoardIds?.[index] ?? index} topic={topic} onRemove={() => setDeleteTarget({ kind: "topic", taskId: task.id, boardId: task.topicBoardIds?.[index] ?? "", label: topic })} onOpen={() => {
                      const boardId = task.topicBoardIds?.[index]
                      if (boardId) setSelectedTopicBoard({ boardId, name: `${task.text} · ${topic}` })
                    }} />
                  ))}
                  </div>
                </div>
              </HoldableTaskRow>
            )
          })}
        </div>

        {currentTable.title === "Importantes" && (
          <div className="flex justify-center mt-8">
            <Button data-workspace-write={isNativeReadOnly() || undefined} onClick={addImportantTask} className="bg-blue-500 hover:bg-blue-600">
              Agregar
            </Button>
          </div>
        )}

        {toast && (
          <div
            className={`fixed top-4 right-4 px-4 py-2 rounded shadow text-white transition-opacity duration-300 ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}
            role="status"
            aria-live="polite"
          >
            {toast.message}
          </div>
        )}

      </div>
    </div>
  )
}
