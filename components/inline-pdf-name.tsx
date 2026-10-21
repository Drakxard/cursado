"use client"

import { useEffect, useRef, useState } from 'react'

export function InlinePdfName({ name, onSave, onClose }: {
  name: string; onSave: (name: string) => Promise<void>; onClose: () => void
}) {
  const [draft, setDraft] = useState(name), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null), busy = useRef(false), closed = useRef(false)
  useEffect(() => { input.current?.select() }, [])
  useEffect(() => { if (error && !saving) input.current?.focus() }, [error, saving])
  const close = () => { closed.current = true; onClose() }
  async function save() {
    if (busy.current || closed.current) return
    const trimmed = draft.trim()
    if (!trimmed) { setError('El nombre no puede estar vacío.'); input.current?.focus(); return }
    const next = /\.pdf$/i.test(trimmed) ? trimmed : trimmed + (name.match(/\.pdf$/i)?.[0] ?? '.pdf')
    if (next === name) { close(); return }
    busy.current = true; setSaving(true); setError('')
    try { await onSave(next); close() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo renombrar el PDF.') }
    finally { busy.current = false; setSaving(false) }
  }
  return <div className="min-w-0 flex-1" onPointerDown={event => event.stopPropagation()} onDragStart={event => event.preventDefault()}>
    <input ref={input} autoFocus aria-label={`Nombre de ${name}`} aria-invalid={Boolean(error)} aria-busy={saving} disabled={saving}
      value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => void save()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save() }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy.current) close() }
      }}
      className="w-full min-w-0 border-0 border-b border-primary bg-transparent px-0 py-0.5 text-sm text-foreground outline-none" />
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </div>
}
