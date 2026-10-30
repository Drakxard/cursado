'use client'
import { useEffect, useImperativeHandle, useRef, useState, type DragEvent, type Ref } from 'react'
import dynamic from 'next/dynamic'
import { HandDrawnBubble } from './hand-drawn-bubble'
import { loadAudioWorkspace, readStudyAudio, updateAudioWorkspace } from '@/lib/subject-audio-storage'
import { groupAudioPair, moveAudioItem, type AudioWorkspace, type StudyAudio } from '@/lib/subject-audio-model'
import { guardCooperationElement } from '@/lib/client/cooperation'
import type { StudyAudioEditorHandle } from './study-audio-editor'
const AudioEditor = dynamic(() => import('./study-audio-editor').then(module => module.StudyAudioEditor), { ssr: false })
const dragType = 'application/x-cursado-audio'
export type SubjectAudiosHandle = { openEditor: () => void; escape: () => boolean }

function AudioCard({ audio, subjectId }: { audio: StudyAudio; subjectId: string }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, objectUrl = ''
    void readStudyAudio(subjectId, audio.id).then(file => {
      if (!disposed) { objectUrl = URL.createObjectURL(file); setUrl(objectUrl) }
    }).catch(error => { if (!disposed) setError(String(error.message)) })
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [subjectId, audio.id, audio.path])
  const status = { pending: 'Sin transcripción en vivo', processing: 'Sin transcripción en vivo', completed: 'Transcripción guardada', error: 'Sin transcripción en vivo', none: 'Sin transcripción en vivo', unavailable: 'Dictado no disponible', partial: 'Transcripción parcial guardada' }[audio.transcription]
  return <>
    <p className="mb-3 text-xl">{audio.name}</p>
    {url && <audio controls preload="metadata" src={url} aria-label={audio.name} className="w-full" onError={() => setError('No se pudo reproducir el audio.')} />}
    <p className="mt-3 text-sm text-neutral-600" role="status">{status}</p>
    {audio.transcriptionError && <p className="text-xs text-neutral-600">{audio.transcriptionError}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </>
}
export function SubjectAudios({ subjectId, hidden, onEditorChange, ref }: { subjectId: string; hidden: boolean; onEditorChange: (open: boolean) => void; ref?: Ref<SubjectAudiosHandle> }) {
  const [workspace, setWorkspace] = useState<AudioWorkspace | null>(null)
  const [parentId, setParentId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ parentId: string | null } | null>(null)
  const [pair, setPair] = useState<{ first: string; second: string } | null>(null)
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const editor = useRef<StudyAudioEditorHandle>(null)
  const revision = useRef(0)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      const request = ++revision.current
      void loadAudioWorkspace(subjectId).then(w => { if (alive && request === revision.current) { setWorkspace(w); setError('') } }).catch(error => { if (alive) setError(error.message) })
    }
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.subjectId === subjectId) refresh() }
    refresh()
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cursado-study-audios') : null
    if (channel) channel.onmessage = event => { if (event.data?.subjectId === subjectId) refresh() }
    window.addEventListener('cursado-audios-changed', changed); window.addEventListener('cursado-cooperation-applied', changed)
    return () => { alive = false; channel?.close(); window.removeEventListener('cursado-audios-changed', changed); window.removeEventListener('cursado-cooperation-applied', changed) }
  }, [subjectId])
  useEffect(() => { onEditorChange(Boolean(editing)); return () => onEditorChange(false) }, [editing, onEditorChange])
  function openEditor() { if (!busy && !editing && !pair) { setEditing({ parentId }); setError('') } }
  useImperativeHandle(ref, () => ({ openEditor, escape: () => {
    if (editing) { editor.current?.close(); return true }
    if (busy) return true
    if (pair) { setPair(null); return true }
    if (parentId) { setParentId(workspace?.folders.find(item => item.id === parentId)?.parentId ?? null); return true }
    return false
  } }))
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (hidden || editing || pair || busy || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key !== '+') return
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]')) return
      event.preventDefault(); event.stopImmediatePropagation(); openEditor()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })
  async function mutate(action: (w: AudioWorkspace) => void) {
    if (busy) return
    setBusy(true); setError('')
    try { await updateAudioWorkspace(subjectId, action); setPair(null) }
    catch (error) { setError(error instanceof Error ? error.message : 'No se pudo mover el elemento.') }
    finally { setBusy(false) }
  }
  function startDrag(event: DragEvent, id: string) { event.dataTransfer.setData(dragType, JSON.stringify({ subjectId, id })); event.dataTransfer.effectAllowed = 'move' }
  function drop(event: DragEvent, destination: string | null, targetAudio = false) {
    event.preventDefault(); event.stopPropagation()
    if (busy) return
    try {
      const source = JSON.parse(event.dataTransfer.getData(dragType))
      if (source.subjectId !== subjectId || typeof source.id !== 'string' || source.id === destination) return
      if (targetAudio) {
        if (!workspace?.audios.some(audio => audio.id === source.id)) throw new Error('Arrastrá el conjunto sobre otro conjunto o al nivel superior.')
        setPair({ first: source.id, second: destination! }); setName('')
      } else void guardCooperationElement(subjectId, source.id, () => { void mutate(w => moveAudioItem(w, source.id, destination)) })
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo mover.') }
  }
  const folder = workspace?.folders.find(item => item.id === parentId)
  return <div className={hidden && !editing ? 'hidden' : 'flex min-h-0 flex-1 flex-col'} data-subject-audios
    onDragOver={event => { if (event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move' } }}
    onDrop={event => { if (event.dataTransfer.types.includes(dragType)) drop(event, parentId) }}>
    {editing && <AudioEditor ref={editor} subjectId={subjectId} parentId={editing.parentId} onClose={() => setEditing(null)} />}
    {!editing && <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-28 pb-28 sm:px-8 sm:pt-32">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {parentId && <button className="rounded-lg border px-4 py-2" onClick={() => setParentId(folder?.parentId ?? null)} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, folder?.parentId ?? null)}>← Nivel superior</button>}
        <h2 className="text-xl">{folder?.name ?? 'Audios'}</h2>
      </div>
      {pair ? <form className="mx-auto flex max-w-lg flex-col gap-4" onSubmit={event => { event.preventDefault(); void mutate(w => groupAudioPair(w, pair.first, pair.second, name)) }}>
        <label className="flex flex-col gap-2">Nombre del conjunto<input autoFocus required disabled={busy} value={name} onChange={event => setName(event.target.value)} className="rounded border p-3" /></label>
        <div className="flex gap-4"><button disabled={busy || !name.trim()} className="rounded border px-4 py-2">Crear conjunto</button><button type="button" disabled={busy} onClick={() => setPair(null)}>Cancelar</button></div>
      </form> : <div className="flex flex-wrap items-start justify-center gap-6" onDragOver={event => event.preventDefault()} onDrop={event => drop(event, parentId)}>
        {workspace?.folders.filter(item => item.parentId === parentId).map(item => <div key={item.id} draggable={!busy} onDragStart={event => startDrag(event, item.id)} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, item.id)}>
          <HandDrawnBubble seed={item.id} color="#a5d8ff" disabled={busy} style={{ width: 170, height: 170 }} onClick={() => { void guardCooperationElement(subjectId, item.id, () => setParentId(item.id)) }} aria-label={`Abrir conjunto ${item.name}`}>
            <span className="text-xl">{item.name}</span><span className="mt-2 block text-sm">{workspace.audios.filter(audio => audio.parentId === item.id).length} audios · {workspace.folders.filter(folder => folder.parentId === item.id).length} conjuntos</span>
          </HandDrawnBubble>
        </div>)}
        {workspace?.audios.filter(item => item.parentId === parentId).map(audio => <div key={audio.id} className="w-80 max-w-full rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm" draggable={!busy} onDragStart={event => startDrag(event, audio.id)} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, audio.id, true)}>
          <AudioCard audio={audio} subjectId={subjectId} />
        </div>)}
        {workspace && !workspace.audios.some(item => item.parentId === parentId) && !workspace.folders.some(item => item.parentId === parentId) && <button onClick={openEditor} className="py-16 text-center text-xl">Pulsá + para grabar o importar un audio</button>}
        {!workspace && !error && <p role="status">Cargando audios…</p>}
      </div>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    </div>}
  </div>
}
