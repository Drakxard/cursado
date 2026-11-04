'use client'

import { useEffect, useRef, useState } from 'react'
import { readWorkspaceJson, writeWorkspaceJson } from '@/lib/workspace-json'
import { openStudyBoard, saveStudyBoard } from '@/lib/study-board-workspace'

type Page = { boardId: string; name: string }
type Props = { rootHandle: FileSystemDirectoryHandle; rootId: string; boardId: string; disabled: boolean; onSelect: (page: Page) => void; onDuplicate: (action: () => Promise<void>) => void; onTheme: () => void }

export function StudyBoardPages({ rootHandle, rootId, boardId, disabled, onSelect, onDuplicate, onTheme }: Props) {
  const [pages, setPages] = useState<Page[]>([])
  const [open, setOpen] = useState(false)
  const [actions, setActions] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const path = `progreso/pizarra-sync/${rootId}.pages.json`
  const current = pages.find(page => page.boardId === boardId)
  useEffect(() => {
    let active = true
    void readWorkspaceJson<Page[]>(rootHandle, path, [{ boardId: rootId, name: 'Página 1' }]).then(value => {
      if (active) setPages(value.length ? value : [{ boardId: rootId, name: 'Página 1' }])
    }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [rootHandle, rootId, path])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) { setOpen(false); setActions(null) } }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setActions(null) } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open])
  const persist = async (next: Page[]) => { await writeWorkspaceJson(rootHandle, path, next); setPages(next); setActions(null) }
  const run = (work: () => Promise<void>) => {
    setBusy(true); setError('')
    void work().catch(reason => setError(String(reason))).finally(() => setBusy(false))
  }
  const add = () => run(async () => {
    const page = { boardId: crypto.randomUUID(), name: `Página ${pages.length + 1}` }
    await openStudyBoard(rootHandle, page.boardId)
    await persist([...pages, page]); onSelect(page)
  })
  const duplicate = (source: Page) => onDuplicate(async () => {
    const original = await openStudyBoard(rootHandle, source.boardId)
    const page = { boardId: crypto.randomUUID(), name: `${source.name} (copia)` }
    await openStudyBoard(rootHandle, page.boardId)
    await saveStudyBoard(rootHandle, page.boardId, { draft: original.record.draft, imported: original.record.imported, status: original.record.status, localPdfReferences: original.record.localPdfReferences })
    await persist([...pages, page]); onSelect(page)
  })
  return <div ref={panel} className="absolute left-[60px] top-3 z-30 text-sm text-slate-800">
    <div className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <button type="button" title="Cambiar tema claro u oscuro" aria-label="Cambiar tema claro u oscuro" onClick={onTheme} className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">☼ ☾</button>
      <button type="button" aria-expanded={open} aria-controls="study-pages-panel" disabled={disabled || busy || !pages.length} onClick={() => setOpen(value => !value)} className="flex max-w-40 items-center gap-2 rounded-lg bg-purple-100 px-3 py-1.5 text-purple-600 disabled:opacity-50"><span aria-hidden="true">▧</span><span className="truncate">{current?.name || 'Página 1'}</span></button>
    </div>
    {open && <div id="study-pages-panel" aria-label="Páginas" className="mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between px-2 py-1"><span>Páginas</span><button aria-label="Crear página" disabled={busy || disabled} onClick={add} className="rounded px-2 text-xl hover:bg-slate-100">+</button></div>
      <div className="max-h-[60vh] overflow-y-auto">{pages.map((page, index) => <div key={page.boardId} className="mb-1">
        <div className={`flex items-center rounded-md ${page.boardId === boardId ? 'bg-purple-100' : 'hover:bg-slate-100'}`}>
          <button disabled={busy || disabled} aria-current={page.boardId === boardId ? 'page' : undefined} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left" onClick={() => { if (page.boardId !== boardId) onSelect(page); setOpen(false) }}>{page.name}</button>
          <button aria-label={`Opciones de ${page.name}`} aria-expanded={actions === page.boardId} className="px-2 py-1 text-purple-600" onClick={() => setActions(actions === page.boardId ? null : page.boardId)}>⋯</button>
        </div>
        {actions === page.boardId && <div className="my-1 flex flex-col rounded-lg bg-neutral-900 p-1 text-xs text-white [&>button]:rounded [&>button]:px-3 [&>button]:py-2 [&>button]:text-left [&>button:hover]:bg-neutral-700 [&>button:disabled]:opacity-40">
          <button onClick={() => run(async () => { const name = window.prompt('Nombre de la página', page.name)?.trim(); if (name) await persist(pages.map(item => item.boardId === page.boardId ? { ...item, name: name.slice(0, 80) } : item)) })}>Renombrar página</button>
          <button disabled={busy || disabled} onClick={() => duplicate(page)}>Duplicar página</button>
          <button disabled={index === 0 || busy} onClick={() => run(async () => { const next = [...pages]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; await persist(next) })}>Mover hacia arriba</button>
          <button disabled={index === pages.length - 1 || busy} onClick={() => run(async () => { const next = [...pages]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; await persist(next) })}>Mover hacia abajo</button>
          <button disabled={pages.length === 1 || busy || disabled} onClick={() => run(async () => { const next = pages.filter(item => item.boardId !== page.boardId); await persist(next); if (page.boardId === boardId) onSelect(next[Math.min(index, next.length - 1)]!) })}>Eliminar página</button>
        </div>}
      </div>)}</div>
    </div>}
    {error && <p role="alert" className="mt-2 max-w-60 rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  </div>
}
