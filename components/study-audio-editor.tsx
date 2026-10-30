'use client'
import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react'
import { saveStudyAudio } from '@/lib/subject-audio-storage'
import type { StudyAudio } from '@/lib/subject-audio-model'

export type StudyAudioEditorHandle = { close: () => boolean }
export function StudyAudioEditor({ subjectId, parentId, onClose, ref }: { subjectId: string; parentId: string | null; onClose: () => void; ref?: Ref<StudyAudioEditorHandle> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [name, setName] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [speech, setSpeech] = useState('El dictado del navegador acompaña la grabación; puede requerir Internet.')
  const id = useRef(crypto.randomUUID())
  const dirty = useRef(false), saving = useRef(false)
  const nameRef = useRef(name); nameRef.current = name
  const closeRef = useRef(onClose); closeRef.current = onClose
  function close() {
    if (saving.current) return false
    if ((dirty.current || nameRef.current.trim()) && !window.confirm('¿Descartar este audio sin guardar?')) return false
    closeRef.current(); return true
  }
  useImperativeHandle(ref, () => ({ close }))
  useEffect(() => {
    const message = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'cursado-audiomass') return
      if (event.data.type === 'ready') setReady(true)
      if (event.data.type === 'dirty') dirty.current = true
      if (event.data.type === 'transcript') setSpeech(event.data.transcriptionError || (event.data.listening ? 'Transcribiendo mientras grabás…' : event.data.transcript ? 'Texto de la grabación conservado.' : 'Sin texto reconocido.'))
      if (event.data.type === 'close') close()
      if (event.data.type === 'error') { saving.current = false; setBusy(false); setError(event.data.error) }
      if (event.data.type === 'audio' && saving.current) {
        try {
          if (!(event.data.blob instanceof Blob)) throw new Error('Audio inválido.')
          const live = { transcript: typeof event.data.transcript === 'string' ? event.data.transcript : '', transcription: event.data.transcription as StudyAudio['transcription'], ...(event.data.transcriptionError ? { transcriptionError: String(event.data.transcriptionError) } : {}) }
          await saveStudyAudio(subjectId, id.current, nameRef.current, parentId, event.data.blob, event.data.duration, live)
          dirty.current = false
          closeRef.current()
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar.'); saving.current = false; setBusy(false) }
      }
    }
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current || nameRef.current.trim()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('message', message); window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('message', message); window.removeEventListener('beforeunload', beforeUnload) }
    // Parent destination is captured when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, parentId])
  return <div className="absolute inset-0 z-50 flex flex-col bg-white text-black" role="region" aria-label="Editor AudioMass" onKeyDown={event => event.stopPropagation()}>
    <form className="flex flex-wrap items-end gap-3 border-b border-neutral-200 p-3" onSubmit={event => {
      event.preventDefault(); if (!ready || saving.current || !name.trim()) return
      saving.current = true; setBusy(true); setError('')
      frame.current?.contentWindow?.postMessage({ source: 'cursado-host', type: 'export' }, location.origin)
    }}>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">Nombre del audio<input required value={name} disabled={busy} onChange={event => setName(event.target.value)} className="rounded border border-neutral-300 px-3 py-2 text-base" /></label>
      <button disabled={!ready || busy || !name.trim()} className="rounded bg-black px-4 py-2 text-white disabled:opacity-40">{busy ? 'Guardando…' : 'Confirmar audio'}</button>
      <button type="button" disabled={busy} onClick={close} className="rounded border px-4 py-2">Cancelar</button>
    </form>
    {error && <p role="alert" className="px-4 py-2 text-red-700">{error}</p>}
    <p role="status" className="px-4 py-1 text-xs text-neutral-600">{speech}</p>
    {!ready && <p role="status" className="p-3">Abriendo AudioMass…</p>}
    <iframe ref={frame} title="AudioMass" src="/vendor/audiomass/index.html?skipintro=1" allow="microphone" className="min-h-0 w-full flex-1 border-0" />
  </div>
}
