'use client'
import { useEffect, useRef, useState, useImperativeHandle, type Ref } from 'react'
import { saveStudyAudio } from '@/lib/subject-audio-storage'
import type { StudyAudio } from '@/lib/subject-audio-model'

export type StudyAudioEditorHandle = { close: () => boolean }
export function StudyAudioEditor({ subjectId, parentId, onClose, ref }: { subjectId: string; parentId: string | null; onClose: () => void; ref?: Ref<StudyAudioEditorHandle> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const id = useRef(crypto.randomUUID())
  const dirty = useRef(false), saving = useRef(false)
  const closeRef = useRef(onClose); closeRef.current = onClose
  function close() {
    if (saving.current) return false
    if ((dirty.current) && !window.confirm('¿Descartar este audio sin guardar?')) return false
    closeRef.current(); return true
  }
  useImperativeHandle(ref, () => ({ close }))
  useEffect(() => {
    const message = async (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'cursado-audiomass') return
      if (event.data.type === 'ready') { setReady(true); frame.current?.focus() }
      if (event.data.type === 'dirty') dirty.current = true
      if (event.data.type === 'close') close()
      if (event.data.type === 'audio' && !saving.current) {
        saving.current = true
        try {
          if (!(event.data.blob instanceof Blob)) throw new Error('Audio inválido.')
          const live = { transcript: typeof event.data.transcript === 'string' ? event.data.transcript : '', transcription: event.data.transcription as StudyAudio['transcription'], ...(event.data.transcriptionError ? { transcriptionError: String(event.data.transcriptionError) } : {}) }
          await saveStudyAudio(subjectId, id.current, event.data.name, parentId, event.data.blob, event.data.duration, live)
          dirty.current = false
          closeRef.current()
        } catch (failure) { saving.current = false; frame.current?.contentWindow?.postMessage({ source: 'cursado-host', type: 'save-error', error: failure instanceof Error ? failure.message : 'No se pudo guardar.' }, location.origin) }
      }
    }
    const recordKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || saving.current) return
      if (event.target instanceof Element && event.target.closest('input,textarea,select,button,[contenteditable]')) return
      event.preventDefault(); event.stopImmediatePropagation()
      frame.current?.contentWindow?.postMessage({ source: 'cursado-host', type: 'record-toggle' }, location.origin)
    }
    window.addEventListener('keydown', recordKey, true)
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('message', message); window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('keydown', recordKey, true); window.removeEventListener('message', message); window.removeEventListener('beforeunload', beforeUnload) }
    // Parent destination is captured when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, parentId])
  return <div className="absolute inset-x-0 top-0 z-50 flex max-h-full flex-col overflow-hidden border-b border-neutral-200 bg-white text-black" style={{ height: '100dvh' }} role="region" aria-label="Editor AudioMass" onKeyDown={event => event.stopPropagation()}>
    {!ready && <p role="status" className="p-3">Abriendo AudioMass…</p>}
    <iframe ref={frame} title="AudioMass" src="/vendor/audiomass/index.html?skipintro=1" allow="microphone" className="block min-h-0 w-full flex-1 border-0" />
  </div>
}
