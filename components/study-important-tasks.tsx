"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { isNativeReadOnly } from "@/lib/native-workspace"
import dynamic from "next/dynamic"
import { useLocalWorkspace } from '@/components/local-workspace-provider'
import { TopicBoardOverlay } from './topic-board-overlay'
import { resolveStudyLocation, updateStudyLocation, flushStudyRoutes, type StudyBoardLocation } from '@/lib/study-location'
import { registerHomeSave } from '@/lib/client/home-navigation'
const ImportantProgressView = dynamic(() => import("@/components/important-progress-view"), { ssr: false })
import "./progress-original/theme.css"
const editing = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=slider], [role=spinbutton]"))

export function StudyImportantTasks({ children, boardLibrary = false }: { children: ReactNode; boardLibrary?: boolean }) {
  const workspace = useLocalWorkspace()
  const [restoredBoard, setRestoredBoard] = useState<StudyBoardLocation | null>(null)
  const [open, setOpen] = useState(false)
  const [hasRestoredLocation, setHasRestoredLocation] = useState(false)
  const [routeError, setRouteError] = useState('')
  useEffect(() => boardLibrary ? undefined : registerHomeSave(flushStudyRoutes), [boardLibrary])
  useEffect(() => {
    if (boardLibrary || isNativeReadOnly() || !navigator.serviceWorker) return
    // Upgrade installed standalone workers before a named Study URL is reloaded.
    void navigator.serviceWorker.getRegistration('/pizarra/').then(registration => registration?.update()).catch(() => {})
  }, [boardLibrary])
  useEffect(() => {
    if (boardLibrary) return
    if (!workspace.isReady || !workspace.rootHandle) return
    let active = true
    void resolveStudyLocation(workspace.rootHandle, { readOnly: isNativeReadOnly() }).then(location => {
      if (!active) return
      setRouteError('')
      // Subject boards are restored by the subject dialog so its modal stays suspended.
      setRestoredBoard(location.subject ? null : location.board); setOpen(location.important); setHasRestoredLocation(true)
    }).catch(error => { if (active) setRouteError(String(error)) })
    return () => { active = false }
  }, [boardLibrary, workspace.isReady, workspace.rootHandle])
  useEffect(() => { if (!boardLibrary && hasRestoredLocation) updateStudyLocation({ importantes: open ? '1' : null }) }, [open, boardLibrary, hasRestoredLocation])
  const [hasOpened, setHasOpened] = useState(false)
  // Retain drafts and pending save queues after the first visit.
  useEffect(() => { if (open) setHasOpened(true) }, [open])
  const [tabsOpen, setTabsOpen] = useState(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const navigation = useRef({open,tabsOpen})
  navigation.current = {open,tabsOpen}
  useEffect(() => {
    if (!isNativeReadOnly()) return
    const back = (event: Event) => {
      if (!navigation.current.open && !navigation.current.tabsOpen) return
      event.preventDefault()
      setOpen(false)
      setTabsOpen(false)
    }
    window.addEventListener('cursado-native-back', back, true)
    return () => window.removeEventListener('cursado-native-back', back, true)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return
      if ((!open && event.key === "ArrowRight")) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(!open)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => { window.removeEventListener("keydown", onKey, true) }
  }, [open])
  if (routeError) return <div role="alert" className="p-6"><p>{routeError}</p><a href="/estudio">Volver a Estudio</a></div>
  if (!boardLibrary && !hasRestoredLocation) return <p role="status" className="p-6">Abriendo Estudio…</p>
  return <div
    data-native-study-tabs={isNativeReadOnly() ? (tabsOpen ? "open" : "closed") : undefined}
    onClick={event => { if (event.target instanceof Element && event.target.closest('[data-study-workspace-tabs] button')) setTabsOpen(false) }}
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
        if (!open && dx < 0) { setTabsOpen(false); setOpen(true) }
        if (open && dx > 0) setOpen(false)
        else if (!open && dx > 0 && isNativeReadOnly()) setTabsOpen(true)
      }
    }}>
    {boardLibrary && !open && <button type="button" className="fixed bottom-4 left-4 z-40 rounded-xl border bg-background px-4 py-2 text-foreground shadow" onClick={() => setOpen(true)}>Importantes</button>}
    {restoredBoard && workspace.isReady && workspace.permissionState === 'granted' && workspace.rootHandle && <TopicBoardOverlay {...restoredBoard} rootHandle={workspace.rootHandle} onClose={() => setRestoredBoard(null)} />}
    <div hidden={open} inert={open}>{children}</div>
    {(open || hasOpened) && <div hidden={!open} inert={!open} className="progress-original"><ImportantProgressView active={open} onBack={() => setOpen(false)} /></div>}
  </div>
}
