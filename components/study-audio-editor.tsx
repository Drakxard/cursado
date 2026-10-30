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
  const [naming, setNaming] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
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
  useEffect(() => { if (naming) { nameInput.current?.focus(); nameInput.current?.select() } }, [naming])
  useEffect(() => {
    const message = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'cursado-audiomass') return
      if (event.data.type === 'ready') setReady(true)
      if (event.data.type === 'save' && !saving.current) setNaming(true)
      if (event.data.type === 'dirty') dirty.current = true
      if (event.data.type === 'transcript') setSpeech(event.data.transcriptionError || (event.data.listening ? 'Transcribiendo mientras grabás…' : event.data.transcript ? 'Texto de la grabación conservado.' : 'Sin texto reconocido.'))
      if (event.data.type === 'close') close()
      if (event.data.type === 'error') { saving.current = false; setBusy(false); setNaming(true); setError(event.data.error) }
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
    {naming && <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.25)', padding: 16 }}>
    <form role="dialog" aria-modal="true" aria-label="Guardar audio" className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!saving.current) { setNaming(false); frame.current?.focus() } }
      if (event.key === 'Tab') {
        const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')]
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
      }
    }} onSubmit={event => {
      event.preventDefault(); if (!ready || saving.current || !name.trim()) return
      saving.current = true; setBusy(true); setError('')
      frame.current?.contentWindow?.postMessage({ source: 'cursado-host', type: 'export' }, location.origin)
    }}>
      <label className="flex flex-col gap-2 text-sm">Nombre del audio<input ref={nameInput} required value={name} disabled={busy} onChange={event => setName(event.target.value)} className="rounded border border-neutral-300 px-3 py-2 text-base" /></label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
      <button type="button" disabled={busy} onClick={() => { setNaming(false); frame.current?.focus() }} className="rounded border px-3 py-2">Cancelar</button>
      <button disabled={!ready || busy || !name.trim()} className="rounded bg-black px-4 py-2 text-white disabled:opacity-40">{busy ? 'Guardando…' : 'Confirmar audio'}</button>
      </div>
      <p role="status" className="text-xs text-neutral-500">{speech}</p>
    </form>
    </div>}
    {!ready && <p role="status" className="p-3">Abriendo AudioMass…</p>}
    <iframe ref={frame} title="AudioMass" src="/vendor/audiomass/index.html?skipintro=1" allow="microphone" className="min-h-0 w-full flex-1 border-0" />
  </div>
}
