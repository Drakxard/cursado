"use client"

import { useEffect, useRef, useState } from 'react'
import { InlineTableEditor } from './study-inline-table-editor'
import { boardPdfReference, type BoardPdfReference, type BoardLinkReference } from '@/lib/board-library-contract'
import { openStudyBoard, saveStudyBoard, confirmStudyMigration } from '@/lib/study-board-workspace'
import { migrationNeedsReview, migrationErrorSummary, migrationTypeLabel, studyCard, type MigrationReport, type StudyAttachment } from '@/lib/study-board-migration'
import { readImportantTasks, importantTaskProgress, importantCountdownStyle } from '@/lib/important-tasks'

export type StudyTopicBoardProps = {
  boardId: string; name: string; rootHandle: FileSystemDirectoryHandle; onClose: () => void
  pdfReferences?: BoardPdfReference[]; cooperationSubjectId?: string; cooperationWeekNumber?: number; backLabel?: string
}
type Destination = Pick<StudyTopicBoardProps, 'boardId' | 'name' | 'pdfReferences' | 'cooperationSubjectId' | 'cooperationWeekNumber'>
type Pin = { id: string; reference: BoardPdfReference }

export function StudyTopicBoardOverlay(props: StudyTopicBoardProps) {
  const [stack, setStack] = useState<Destination[]>([{ boardId: props.boardId, name: props.name, pdfReferences: props.pdfReferences, cooperationSubjectId: props.cooperationSubjectId, cooperationWeekNumber: props.cooperationWeekNumber }])
  const destination = stack[stack.length - 1]!
  // A new session owns all iframe messages and resources for one board.
  return <StudyBoardSession key={destination.boardId} {...props} {...destination} backLabel={stack.length > 1 ? 'Volver a la pizarra anterior' : props.backLabel}
    onClose={() => stack.length > 1 ? setStack(current => current.slice(0, -1)) : props.onClose()}
    onNavigate={value => setStack(current => [...current, value])} onCancel={props.onClose} />
}

function StudyBoardSession({ boardId, name, rootHandle, pdfReferences, onClose, onNavigate, onCancel, backLabel = 'Volver a Estudio' }: StudyTopicBoardProps & { onNavigate: (value: Destination) => void; onCancel: () => void }) {
  const [session] = useState(() => crypto.randomUUID())
  const frame = useRef<HTMLIFrameElement>(null), library = useRef<HTMLIFrameElement>(null), readerFrame = useRef<HTMLIFrameElement>(null)
  const [initial, setInitial] = useState<Awaited<ReturnType<typeof openStudyBoard>> | null>(null)
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [menu, setMenu] = useState(false), [split, setSplit] = useState(false), [urlInput, setUrlInput] = useState(false), [url, setUrl] = useState('')
  const [pins, setPins] = useState<Pin[]>([]), [reader, setReader] = useState<BoardPdfReference | null>(null), [readerVisible, setReaderVisible] = useState(false)
  const [review, setReview] = useState<MigrationReport | null>(null), [attachment, setAttachment] = useState<{ id: string; study: StudyAttachment } | null>(null)
  const [closing, setClosing] = useState(false)
  const files = useRef<HTMLInputElement>(null), saveQueue = useRef<Promise<unknown>>(Promise.resolve()), positions = useRef(new Map<number, string>())
  const saveError = useRef<unknown>(null)
  const pendingClose = useRef<(() => void) | null>(null)
  const live = useRef({ initial, pins, reader, readerVisible, review, attachment })
  live.current = { initial, pins, reader, readerVisible, review, attachment }
  const send = (type: string, data: Record<string, unknown> = {}) => frame.current?.contentWindow?.postMessage({ type: `study-board:${type}`, session, boardId, ...data }, location.origin)
  const save = (work: () => Promise<unknown>) => {
    const result = saveQueue.current.then(work)
    saveQueue.current = result.then(value => { saveError.current = null; return value }, reason => { saveError.current = reason; setError(String(reason)) })
    return result
  }
  const initialize = () => { const value = live.current.initial; if (value) send('init', { ...value.record, name, snapshot: value.snapshot, pdfReferences }) }
  const focusBoard = () => frame.current?.focus()
  const closeReader = () => {
    live.current.readerVisible = false
    setReaderVisible(false)
    if (!live.current.pins.some(pin => pin.reference.materialId === live.current.reader?.materialId)) setReader(null)
    focusBoard()
  }
  const openReader = (value: BoardPdfReference) => { live.current.reader = value; live.current.readerVisible = true; setReader(value); setReaderVisible(true); setMenu(false) }
  const togglePdf = () => {
    if (live.current.readerVisible) closeReader()
    else { const pin = live.current.pins.at(-1); if (pin) openReader(pin.reference) }
  }
  const close = (action: () => void = onClose) => { if (!ready) { action(); return }; pendingClose.current = action; setClosing(true); send('close') }
  const navigate = (reference: BoardLinkReference) => {
    const id = reference.boardId.startsWith('local:important-') ? reference.boardId.slice(16) : reference.boardId
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) { setError('Este acceso no pertenece a una pizarra de Estudio.'); return }
    close(() => onNavigate({ boardId: id, name: reference.name, ...reference.topic }))
  }
  const refreshTasks = async () => {
    try {
      const tasks = await readImportantTasks(rootHandle)
      send('countdowns', { tasks: Object.fromEntries(tasks.map(task => { const days = importantTaskProgress(task).remaining; return [task.id, { days, color: importantCountdownStyle(days).from }] })) })
    } catch (reason) { setError(String(reason)) }
  }
  useEffect(() => {
    let active = true
    void openStudyBoard(rootHandle, boardId).then(value => { if (active) { live.current.initial = value; setInitial(value) } }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [rootHandle, boardId])
  useEffect(() => { if (initial) initialize() }, [initial])
  useEffect(() => {
    const previousOverflow = document.body.style.overflow, previousFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    const receive = (event: MessageEvent) => {
      const data = event.data
      if (event.origin !== location.origin || data?.session !== session || data?.boardId !== boardId) return
      if (event.source === frame.current?.contentWindow) {
        if (data.type === 'study-board:request-init') initialize()
        if (data.type === 'study-board:ready') {
          setReady(true); setError(''); const report = data.report as MigrationReport | undefined, current = live.current.initial
          if (report && current && current.record.status !== 'accepted' && migrationNeedsReview(report, current.approved)) setReview(report)
          else if (report && current?.record.status !== 'accepted') void save(() => saveStudyBoard(rootHandle, boardId, { status: 'accepted', report })).catch(() => {})
          focusBoard(); void refreshTasks()
        }
        if (data.type === 'study-board:checkpoint' && typeof data.draft === 'string') void save(() => saveStudyBoard(rootHandle, boardId, { draft: data.draft, report: data.report, imported: !!data.imported })).catch(() => {})
        if (data.type === 'study-board:closed') void saveQueue.current.then(() => { if (saveError.current) { setClosing(false); return }; const action = pendingClose.current; pendingClose.current = null; action?.() })
        if (data.type === 'study-board:error') { setError(data.error || 'No se pudo abrir la pizarra.'); setClosing(false) }
        if (data.type === 'study-board:migration-errors') { setReview(null); setError(migrationErrorSummary(data.report.errors || [])); setStatus('') }
        if (data.type === 'study-board:status') setStatus(data.status || '')
        if (data.type === 'study-board:pins') {
          const valid = (data.pins || []).flatMap((pin: any) => { const reference = boardPdfReference(pin.reference); return reference && typeof pin.id === 'string' ? [{ id: pin.id, reference }] : [] })
          live.current.pins = valid; setPins(valid)
          if (!live.current.readerVisible && live.current.reader && !valid.some((pin: Pin) => pin.reference.materialId === live.current.reader!.materialId)) setReader(null)
        }
        if (data.type === 'study-board:pin' && typeof data.id === 'string') send('pin', { id: data.id })
        if (data.type === 'study-board:toggle-pdf') togglePdf()
        if (data.type === 'study-board:menu') setMenu(value => !value)
        if (data.type === 'study-board:files') send('import-files', { files: data.files })
        if (data.type === 'study-board:changed') void refreshTasks()
        if (data.type === 'study-board:open') {
          const study = data.study as StudyAttachment
          if (study?.kind === 'pdf') { const reference = boardPdfReference(study.reference); if (reference) openReader(reference) }
          else if (study?.kind === 'board') navigate(study.reference)
          else if (study?.kind === 'important') { setAttachment({ id: data.id, study }); setSplit(true) }
          else if (study) setAttachment({ id: data.id, study })
        }
        return
      }
      const isReader = event.source === readerFrame.current?.contentWindow, isLibrary = event.source === library.current?.contentWindow
      if (!isReader && !isLibrary) return
      if (data.type === 'board-library:ready') {
        event.source?.postMessage({ type: 'board-library:init', session, boardId, rootHandle, reference: isReader ? live.current.reader : null, readerVisible: live.current.readerVisible, readingPosition: isReader ? positions.current.get(live.current.reader!.materialId) : undefined }, { targetOrigin: location.origin })
      }
      if (isReader && data.type === 'board-library:reading-position' && typeof data.hash === 'string' && data.hash.length <= 512 && live.current.reader) {
        positions.current.set(live.current.reader.materialId, data.hash)
        if (positions.current.size > 50) positions.current.delete(positions.current.keys().next().value!)
      }
      if (isReader && data.type === 'board-library:reader-closed') closeReader()
      if (isLibrary && ['board-library:escape', 'board-library:calendar-closed'].includes(data.type)) { setSplit(false); setAttachment(null); focusBoard() }
    }
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || (event.target as Element)?.closest('input,textarea,select,[contenteditable],[role="textbox"]')) return
      if (event.key === '<') { event.preventDefault(); togglePdf() }
      if (event.key === 'Escape' && live.current.readerVisible) { event.preventDefault(); closeReader() }
    }
    const timer = setInterval(() => void refreshTasks(), 5000)
    const refresh = () => void refreshTasks()
    window.addEventListener('message', receive); window.addEventListener('keydown', key); window.addEventListener('focus', refresh); window.addEventListener('cursado-workspace-saved', refresh)
    return () => {
      clearInterval(timer); document.body.style.overflow = previousOverflow; previousFocus?.focus({ preventScroll: true })
      window.removeEventListener('message', receive); window.removeEventListener('keydown', key); window.removeEventListener('focus', refresh); window.removeEventListener('cursado-workspace-saved', refresh)
    }
  }, [session, boardId, rootHandle])
  useEffect(() => {
    readerFrame.current?.contentWindow?.postMessage({ type: 'board-library:reader-visibility', session, boardId, visible: readerVisible }, location.origin)
    if (readerVisible) readerFrame.current?.focus()
  }, [readerVisible, reader, session, boardId])
  useEffect(() => {
    if (!readerVisible && reader && !pins.some(pin => pin.reference.materialId === reader.materialId)) setReader(null)
  }, [pins, readerVisible, reader])
  async function accept() {
    if (!review) return
    try {
      await saveQueue.current
      if (saveError.current) throw saveError.current
      await confirmStudyMigration(rootHandle, boardId, review)
      if (live.current.initial) live.current.initial.record.status = 'accepted'
      setReview(null)
    } catch (reason) { setError(String(reason)) }
  }
  async function cancel() {
    try { await save(() => saveStudyBoard(rootHandle, boardId, { status: 'cancelled' })); close(onCancel) } catch (reason) { setError(String(reason)) }
  }
  function addVideo(event: React.FormEvent) {
    event.preventDefault()
    try {
      const parsed = new URL(url), host = parsed.hostname.toLowerCase(), id = host === 'youtu.be' ? parsed.pathname.split('/')[1] : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host) ? parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] : null
      if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Pegá un enlace válido de YouTube.')
      const start = Number(parsed.searchParams.get('start') || parsed.searchParams.get('t')?.replace(/s$/, '') || 0)
      const object = studyCard('', 'YouTube', { kind: 'youtube', videoId: id, start: Number.isFinite(start) ? start : 0 }); delete object.x; delete object.y; object.width = 560; object.height = 360
      send('insert', { object }); setUrl(''); setUrlInput(false)
    } catch (reason) { setError(String(reason)) }
  }
  return <div role="dialog" aria-modal="true" aria-label={`Pizarra de ${name}`} className="fixed inset-0 z-[150] bg-white text-slate-900">
    <div className="flex h-full">
      <div className="relative min-w-0" style={{ width: split ? '50%' : '100%', height: '100%' }}>
        {initial && <iframe ref={frame} title={`Pizarra de ${name}`} src={`/study-board/index.html?topicBoard=${encodeURIComponent(boardId)}&room=${encodeURIComponent(initial.record.roomId)}&session=${session}`} className="h-full w-full border-0" onLoad={initialize} />}
        {!ready && !error && !status && <p role="status" className="absolute bottom-4 left-4 rounded bg-white p-3">Abriendo pizarra…</p>}
      </div>
      {split && <aside className="relative h-full w-1/2 border-l bg-background text-foreground">
        <button className="absolute right-3 top-2 z-10 rounded border bg-background px-2" aria-label="Cerrar biblioteca" onClick={() => { setSplit(false); setAttachment(null); focusBoard() }}>×</button>
        <iframe key={attachment?.study.taskId || 'library'} ref={library} title="Biblioteca de Estudio" className="h-full w-full border-0" src={`/biblioteca/pizarra?session=${session}&boardId=${encodeURIComponent(boardId)}${attachment?.study.kind === 'important' ? `&mode=calendar&taskId=${encodeURIComponent(attachment.study.taskId || '')}` : ''}`} />
      </aside>}
    </div>
    {!readerVisible && <button aria-label={backLabel} title={backLabel} disabled={closing} onClick={() => close()} className="absolute left-3 top-3 z-20 h-10 w-10 rounded-xl border bg-white shadow">{closing ? '…' : '←'}</button>}
    {!!pins.length && !readerVisible && <nav aria-label="PDF fijado" className="absolute right-4 bottom-4 z-20 flex gap-2">{pins.slice(-1).map(pin => <button key={pin.id} title={`${pin.reference.fileName} · <`} onClick={() => openReader(pin.reference)} className="rounded border bg-white px-3 py-2 shadow">📌 {pin.reference.fileName}</button>)}</nav>}
    {menu && <div className="absolute bottom-16 left-16 z-30 flex flex-col gap-1 rounded-xl border bg-white p-2 shadow-lg">
      <button className="rounded px-4 py-2 text-left hover:bg-slate-100" onClick={() => { files.current?.click(); setMenu(false) }}>Agregar material</button>
      <button className="rounded px-4 py-2 text-left hover:bg-slate-100" onClick={() => { setUrlInput(true); setMenu(false) }}>Link YouTube</button>
      <button className="rounded px-4 py-2 text-left hover:bg-slate-100" onClick={() => { setSplit(true); setAttachment(null); setMenu(false) }}>Biblioteca</button>
    </div>}
    {urlInput && <form onSubmit={addVideo} className="absolute bottom-16 left-16 z-30 flex max-w-[85vw] gap-1 rounded-lg border bg-white p-2 shadow"><input autoFocus type="url" aria-label="Link YouTube" placeholder="Link de YouTube" value={url} onChange={event => setUrl(event.target.value)} className="min-w-0 rounded border px-2" /><button type="submit">Agregar</button><button type="button" aria-label="Cerrar enlace" onClick={() => setUrlInput(false)}>×</button></form>}
    <input ref={files} hidden type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.xlsx,.xlsm,.csv" onChange={event => { const selected = [...(event.target.files || [])]; event.target.value = ''; send('import-files', { files: selected }) }} />
    {reader && <div aria-hidden={!readerVisible} inert={!readerVisible} role={readerVisible ? 'dialog' : undefined} aria-modal={readerVisible || undefined} aria-label={`Leer ${reader.fileName}`} className="absolute inset-0 z-40 bg-white" style={{ visibility: readerVisible ? 'visible' : 'hidden', pointerEvents: readerVisible ? 'auto' : 'none' }}>
      <iframe key={reader.materialId} ref={readerFrame} title="Lector de PDF de la pizarra" className="h-full w-full border-0" src={`/biblioteca/pizarra?mode=reader&session=${session}&boardId=${encodeURIComponent(boardId)}&materialId=${reader.materialId}`} />
    </div>}
    {attachment && !['important', 'pdf', 'board', 'youtube'].includes(attachment.study.kind) && <StudyAttachmentEditor value={attachment} onClose={() => setAttachment(null)} onSave={table => { send('update-table', { id: attachment.id, table }); setAttachment(null) }} />}
    {review && !readerVisible && !error && <div role="status" className="absolute bottom-3 left-3 z-30 max-w-sm rounded-xl border bg-white p-3 text-sm shadow-lg">
      <p>¿Confirmás la migración?</p><p className="text-xs text-slate-600">{review.types.map(migrationTypeLabel).join(', ')}{review.partial.length ? ` · Conversión parcial: ${review.partial.map(migrationTypeLabel).join(', ')}` : ''}</p>
      {!!review.errors.length && <p role="alert" className="text-red-700">{review.errors.join(' · ')}</p>}
      <div className="mt-2 flex gap-3"><button disabled={!!review.errors.length} onClick={() => void accept()} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40">Aceptar</button><button onClick={() => void cancel()}>Cancelar</button></div>
    </div>}
    {(error || status) && <div role={error ? 'alert' : 'status'} className="absolute bottom-3 left-3 z-50 max-w-sm rounded-xl border bg-white p-3 text-sm shadow" style={{ maxHeight: 'min(240px, 40vh)', overflow: 'auto' }}>
      <p className="whitespace-pre-wrap">{error || status}</p>
      {error && <div className="mt-2 flex gap-3">{!ready ? <><button onClick={() => { setError(''); setReview(null); setStatus('Reintentando la migración…'); initialize() }}>Reintentar migración</button><button onClick={() => void cancel()}>Volver a Estudio</button></> : <button onClick={() => setError('')}>Cerrar aviso</button>}</div>}
    </div>}
  </div>
}

function StudyAttachmentEditor({ value, onClose, onSave }: { value: { id: string; study: StudyAttachment }; onClose: () => void; onSave: (table: any) => void }) {
  const [table, setTable] = useState(() => structuredClone(value.study.table))
  return <div role="dialog" aria-modal="true" aria-label={table ? 'Editar tabla' : 'Información original'} className="absolute inset-8 z-40 flex flex-col overflow-auto rounded-xl border bg-white p-4 shadow-xl">
    <div className="mb-3 flex gap-4"><button onClick={onClose}>Cerrar</button>{table && <button onClick={() => onSave(table)}>Guardar tabla</button>}</div>
    {table ? <div className="relative min-h-0 flex-1 overflow-auto"><InlineTableEditor table={{...table,x:0,y:120,rotation:0}} camera={{x:0,y:0,zoom:1}} anchorRef={null}
      onChange={setTable} notice="" onMoveStart={()=>{}} onMove={()=>{}} onMoveEnd={()=>{}}
      onCellChange={(r,c,input)=>setTable((current:any)=>({...current,cells:current.cells.map((row:any[],ri:number)=>ri===r?row.map((cell:any,ci:number)=>ci===c?{...cell,input}:cell):row)}))}
      onPasteCells={(r,c,raw)=>setTable((current:any)=>{const pasted=raw.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(line=>line.split('\t'));const rows=Math.min(180,Math.max(current.cells.length,r+pasted.length)),cols=Math.min(32,Math.max(current.cells[0]?.length||0,c+Math.max(...pasted.map(row=>row.length))));return {...current,cells:Array.from({length:rows},(_,ri)=>Array.from({length:cols},(_,ci)=>{const cell=current.cells[ri]?.[ci]||{input:''};return ri>=r&&ci>=c&&pasted[ri-r]?.[ci-c]!==undefined?{...cell,input:pasted[ri-r][ci-c]}:cell}))}})}
      onAddRow={()=>setTable((current:any)=>({...current,cells:[...current.cells,Array.from({length:current.cells[0]?.length||1},()=>({input:''}))].slice(0,180)}))}
      onAddColumn={()=>setTable((current:any)=>({...current,cells:current.cells.map((row:any[])=>[...row,{input:''}].slice(0,32))}))}
      onCopyRange={range=>{const text=table.cells.slice(Math.min(range.r0,range.r1),Math.max(range.r0,range.r1)+1).map((row:any[])=>row.slice(Math.min(range.c0,range.c1),Math.max(range.c0,range.c1)+1).map(cell=>cell.input).join('\t')).join('\n');void navigator.clipboard.writeText(text)}}
      onExport={()=>{void (async()=>{const response=await fetch('/pizarra/api/excel/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:table.name,cells:table.cells})});if(!response.ok)throw new Error('No se pudo exportar la tabla.');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=(table.name||'tabla')+'.xlsx';a.click();URL.revokeObjectURL(url)})().catch(error=>alert(String(error)))}} />
    </div> : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(value.study.original, null, 2)}</pre>}
  </div>
}
