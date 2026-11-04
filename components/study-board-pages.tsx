'use client'

import { useEffect, useRef, useState } from 'react'
import { readWorkspaceJson, writeWorkspaceJson } from '@/lib/workspace-json'
import { openStudyBoard, saveStudyBoard } from '@/lib/study-board-workspace'

type Page = { boardId: string; name: string }
type Props = { rootHandle: FileSystemDirectoryHandle; rootId: string; boardId: string; disabled: boolean; onSelect: (page: Page) => void; onDuplicate: (action: () => Promise<void>) => void; onTheme: () => void; theme: string; onImages: (mode: string) => void }

export function StudyBoardPages({ rootHandle, rootId, boardId, disabled, onSelect, onDuplicate, onTheme, theme, onImages }: Props) {
  const [imageMode, setImageMode] = useState('auto')
  useEffect(() => { try { setImageMode(localStorage.getItem('study-night-images') || 'auto') } catch {} }, [])
  const [pages, setPages] = useState<Page[]>([])
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInput = useRef<HTMLInputElement>(null)
  const renameId = useRef<string | null>(null)
  const [actions, setActions] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const path = `progreso/pizarra-sync/${rootId}.pages.json`
  const current = pages.find(page => page.boardId === boardId)
  useEffect(() => {
    let active = true
    void readWorkspaceJson<Page[]>(rootHandle, path, [{ boardId: rootId, name: 'Page 1' }]).then(value => {
      if (active) setPages(value.length ? value : [{ boardId: rootId, name: 'Page 1' }])
    }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [rootHandle, rootId, path])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) { renameInput.current?.blur(); setOpen(false); setActions(null) } }
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
  const startRename = (page: Page) => {
    renameId.current = page.boardId
    setRenameValue(page.name); setRenaming(page.boardId); setActions(null)
  }
  useEffect(() => {
    if (renaming) { renameInput.current?.focus(); renameInput.current?.select() }
  }, [renaming])
  const finishRename = (value: string) => {
    const id = renameId.current
    if (!id) return
    renameId.current = null
    setRenaming(null)
    const name = value.trim().slice(0, 80)
    if (name && name !== pages.find(page => page.boardId === id)?.name) {
      run(() => persist(pages.map(page => page.boardId === id ? { ...page, name } : page)))
    }
  }
  const add = () => run(async () => {
    const page = { boardId: crypto.randomUUID(), name: `Page ${pages.length + 1}` }
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
  return <div ref={panel} data-board-theme={theme} className="study-page-navigation absolute left-12 top-3 z-30 text-sm text-slate-800">
    <div className="study-page-toolbar">
      <button type="button" role="switch" aria-checked={theme === 'dark'} title="Modo noche" aria-label="Modo noche" onClick={onTheme} className="study-theme-switch">
        <span className="study-theme-thumb" />
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="study-theme-sun"><circle cx="12" cy="12" r="3.75" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="study-theme-moon"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" /></svg>
      </button>
      <button type="button" aria-expanded={open} aria-controls="study-pages-panel" disabled={disabled || busy || !pages.length} onClick={() => setOpen(value => !value)} className="study-page-trigger">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"><path d="M7 5V3h14v15h-2" /><rect x="3" y="7" width="14" height="15" rx="1" /><text x="10" y="18" textAnchor="middle" fontSize="10" fontFamily="Arial, sans-serif" fill="currentColor" stroke="none">{pages.length || 1}</text></svg>
        <span className="truncate">{current?.name || 'Page 1'}</span>
      </button>
    </div>
    <style>{`
      .study-page-toolbar { display:flex; align-items:center; gap:8px; height:44px; font-family:Arial,sans-serif; }
      .study-theme-switch { position:relative; display:flex; align-items:center; justify-content:space-around; flex-shrink:0; width:68px; height:34px; padding:2px; border:1px solid #e2e5eb; border-radius:18px; background:#f0f2f5; color:#647084; cursor:pointer; }
      .study-theme-switch svg { position:relative; z-index:1; width:19px; height:19px; }
      .study-theme-thumb { position:absolute; left:3px; top:3px; width:26px; height:26px; border-radius:50%; background:white; box-shadow:0 1px 4px #00000016; transition:transform 160ms ease; }
      .study-theme-switch[aria-checked="true"] .study-theme-thumb { transform:translateX(34px); }
      .study-theme-switch[aria-checked="false"] .study-theme-sun { color:#343b46; }
      .study-page-trigger { display:flex; align-items:center; gap:7px; max-width:180px; height:36px; padding:0 3px; border:0; border-radius:6px; background:transparent; color:#242424; font-size:14px; cursor:pointer; }
      .study-page-trigger:disabled { opacity:.5; cursor:default; }
      .study-page-trigger:focus-visible,.study-theme-switch:focus-visible { outline:2px solid #8b5cf6; outline-offset:3px; }
      [data-board-theme="dark"] .study-theme-switch { background:#252c37; border-color:#394252; color:#a6afbf; }
      [data-board-theme="dark"] .study-theme-thumb { background:#424c5d; }
      [data-board-theme="dark"] .study-theme-moon,[data-board-theme="dark"] .study-page-trigger { color:#edf0f5; }
      @media(prefers-reduced-motion:reduce) { .study-theme-thumb { transition:none; } }

      [data-board-theme="dark"] { color: #e5e7eb; }
      [data-board-theme="dark"] .bg-white { background-color: #191e27; border-color: #343c49; }
      [data-board-theme="dark"] .bg-slate-100 { background-color: #2a3240; color: #e5e7eb; }
      [data-board-theme="dark"] .bg-purple-100 { background-color: #40305d; color: #dfc9ff; }
      [data-board-theme="dark"] .text-purple-600 { color: #d8b4fe; }
      [data-board-theme="dark"] button:hover { background-color: #30394a; }
    `}</style>
    {open && <div id="study-pages-panel" aria-label="Páginas" className="mt-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between px-2 py-1"><span>Páginas</span><button aria-label="Crear página" disabled={busy || disabled} onClick={add} className="rounded px-2 text-xl hover:bg-slate-100">+</button></div>
      {theme === 'dark' && <label className="mb-2 block border-b border-slate-600 px-2 pb-3 text-xs">Imágenes de noche
        <select aria-label="Filtro nocturno de imágenes" value={imageMode} onChange={event => { const mode = event.target.value; setImageMode(mode); try { localStorage.setItem('study-night-images', mode) } catch {}; onImages(mode) }} className="mt-1 w-full rounded border border-slate-600 bg-transparent p-1.5">
          <option className="bg-slate-900 text-white" value="auto">Automático (esquemas claros)</option>
          <option className="bg-slate-900 text-white" value="original">Colores originales</option>
          <option className="bg-slate-900 text-white" value="invert">Invertir todas</option>
        </select>
      </label>}
      <div className="max-h-[60vh] overflow-y-auto">{pages.map((page, index) => <div key={page.boardId} className="mb-1">
        <div className={`flex items-center rounded-md ${page.boardId === boardId ? 'bg-purple-100' : 'hover:bg-slate-100'}`}>
          {renaming === page.boardId ? <input
            ref={renameInput}
            aria-label="Nombre de la página"
            value={renameValue}
            maxLength={80}
            onChange={event => setRenameValue(event.target.value)}
            onBlur={event => finishRename(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); renameId.current = null; setRenaming(null) }
            }}
            className="m-1 min-w-0 flex-1 rounded border border-purple-400 bg-transparent px-1 py-0.5 text-inherit outline-none focus:ring-1 focus:ring-purple-400"
          /> : <button disabled={busy || disabled} aria-current={page.boardId === boardId ? 'page' : undefined} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left" onClick={() => { if (page.boardId !== boardId) onSelect(page); setOpen(false) }}>{page.name}</button>}
          <button aria-label={`Opciones de ${page.name}`} aria-expanded={actions === page.boardId} className="px-2 py-1 text-purple-600" onClick={() => setActions(actions === page.boardId ? null : page.boardId)}>⋯</button>
        </div>
        {actions === page.boardId && <div className="my-1 flex flex-col rounded-lg bg-neutral-900 p-1 text-xs text-white [&>button]:rounded [&>button]:px-3 [&>button]:py-2 [&>button]:text-left [&>button:hover]:bg-neutral-700 [&>button:disabled]:opacity-40">
          <button disabled={busy || disabled} onClick={() => startRename(page)}>Renombrar página</button>
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
