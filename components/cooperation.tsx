'use client'
import { useEffect, useState } from 'react'
import { ListChecks, RefreshCw, X } from 'lucide-react'
import { acceptCooperationSphere, cooperationState, createCooperationGroup, decideCooperationDeletion, dismissCooperationSphere, notifyCooperationDeletion, refreshCooperation, startCooperationBackground, synchronizeCooperation, type CooperativeSphere, type PendingDeletion } from '@/lib/client/cooperation'
import { isNativeReadOnly } from '@/lib/native-workspace'

export function useCooperation() {
  const [state, setState] = useState(cooperationState)
  useEffect(() => {
    const update = () => setState({ ...cooperationState() })
    window.addEventListener('cursado-cooperation-changed', update); update()
    return () => window.removeEventListener('cursado-cooperation-changed', update)
  }, [])
  return state
}
export function CooperationGroupForm({ onCreated }: { onCreated?: () => void }) {
  const [names, setNames] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [login, setLogin] = useState(false), [password, setPassword] = useState('')
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (login) {
        const response = await fetch('/pizarra/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: names, password }) })
        const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'No se pudo ingresar.')
        setLogin(false); setNames(''); setPassword(''); await refreshCooperation()
      } else { await createCooperationGroup(names); setNames(''); onCreated?.() }
    } catch (reason) { setError(String((reason as Error).message)); if (/sesión|sesi[oó]n/i.test((reason as Error).message)) setLogin(true) }
    finally { setBusy(false) }
  }}>
    {login && <p>Ingresá con tu cuenta de Pizarra para cooperar.</p>}
    <label className="block">Nombre de usuario<input aria-label="Nombre de usuario" className="mt-1 block w-full rounded border bg-transparent px-3 py-2" autoComplete={login ? 'username' : 'off'} value={names} onChange={e => setNames(e.target.value)} placeholder={login ? 'Tu usuario de Pizarra' : '[PersonaA, PersonaB]'} /></label>
    {login && <label className="block">Contraseña<input aria-label="Contraseña" type="password" autoComplete="current-password" className="mt-1 block w-full rounded border bg-transparent px-3 py-2" value={password} onChange={e => setPassword(e.target.value)} /></label>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="submit" disabled={busy || !names.trim()} className="rounded border px-4 py-2 disabled:opacity-50">{busy ? 'Conectando…' : login ? 'Ingresar' : 'Cooperar'}</button>
  </form>
}
export function CooperationInvitation({ sphere, onClose, onAccepted }: { sphere: CooperativeSphere; onClose: () => void; onAccepted: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const accept = async (choose: boolean) => {
    setBusy(true); setError('')
    try {
      await acceptCooperationSphere(sphere, choose ? { choose: true } : { background: true })
      onAccepted()
      if (choose && !location.pathname.startsWith('/estudio')) location.assign('/estudio')
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }
  return <section role="dialog" aria-modal="true" aria-label="Nuevo contenido cooperativo" className="relative w-full max-w-sm space-y-5 rounded-2xl border bg-background p-6 text-foreground shadow-xl" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose() }
    if (event.key === 'Tab') {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const target = event.shiftKey ? buttons.at(-1) : buttons[0]
      if (!buttons.length || event.shiftKey && document.activeElement === buttons[0] || !event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); target?.focus() }
    }
  }}>
    <button aria-label="Cerrar invitación" disabled={busy} onClick={onClose} className="absolute right-3 top-2 rounded-full px-2 py-1"><X className="h-5 w-5" /></button>
    <h2 className="pr-5 text-lg font-medium">{sphere.name}</h2>
    <div className="grid grid-cols-2 gap-3">
      <button autoFocus disabled={busy} onClick={() => void accept(false)} className="rounded-xl border p-4 hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-50"><RefreshCw aria-hidden="true" className="mx-auto mb-2 h-6 w-6" />Sincronizar todo</button>
      <button disabled={busy} onClick={() => void accept(true)} className="rounded-xl border p-4 hover:bg-accent focus-visible:outline focus-visible:outline-2 disabled:opacity-50"><ListChecks aria-hidden="true" className="mx-auto mb-2 h-6 w-6" />Elegir</button>
    </div>
    {busy && <p role="status" className="text-center text-sm text-muted-foreground">Cargando…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>
}
export function CooperationPanel({ onOpen }: { onOpen: (subjectId: string, groupId: string) => void }) {
  const state = useCooperation(), [invite, setInvite] = useState<CooperativeSphere | null>(null), [error, setError] = useState('')
  return <section className="relative z-10 mx-auto w-full max-w-2xl space-y-5 rounded-2xl border bg-background p-6 shadow-sm" aria-label="Estudio cooperativo">
    <h1 className="text-xl font-medium">Cooperativo</h1>
    <CooperationGroupForm />
    {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    {!state.groups.length && <p className="text-muted-foreground">Todavía no hay esferas compartidas. Agregá compañeros y copiá o mové una esfera al grupo.</p>}
    {state.groups.map(group => <section key={group.id} className="space-y-3 rounded-xl border p-4">
      <h2>{group.members.map(m => m.display_name).join(', ')}</h2>
      {!group.spheres.length && <p className="text-sm text-muted-foreground">Este grupo está vacío.</p>}
      <div className="flex flex-wrap gap-4">{group.spheres.map(sphere => {
        const mirror = state.mirrors[sphere.id], ready = mirror && (!mirror.downloading || mirror.metadataReady)
        const deleted = state.deletions.find(d => d.sphereId === sphere.id && d.key === 'sphere.json')
        if (deleted?.decision === 'delete') return null
        return <div key={sphere.id} className="max-w-48 text-center">
          <button className={`min-h-20 min-w-28 rounded-[50%] border-2 p-4 ${!ready || deleted?.decision === 'wait' ? 'opacity-40 grayscale' : ''}`} style={{ borderColor: sphere.color }} onClick={() => {
            if (!ready) { if (sphere.ready !== false) setInvite(sphere); return }
            else if (deleted?.decision === 'wait') window.dispatchEvent(new CustomEvent('cursado-cooperation-review', { detail: { pending: deleted, open: () => onOpen(mirror.binding.subjectId, group.id) } }))
            else onOpen(mirror.binding.subjectId, group.id)
          }}>{sphere.name}</button>
          {sphere.ready === false && <p role="status" className="mt-1 text-xs">Preparando publicación…</p>}
          {!ready && sphere.ready !== false && <p className="mt-1 text-xs">Pendiente · {(sphere.bytes / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} MB</p>}
          {deleted?.decision === 'keep' && <p className="text-xs">Personal</p>}
          {mirror?.transfer && <p role="status" className="mt-1 text-xs">{mirror.transfer.phase === 'uploading' ? 'Subiendo' : 'Descargando'} archivos en segundo plano: {mirror.transfer.completed}/{mirror.transfer.total}</p>}
          {mirror?.error && <div role="alert" className="text-xs text-red-600">{mirror.error} <button className="underline" onClick={()=>void synchronizeCooperation()}>Reintentar</button></div>}
          {mirror && mirror.baseline.conflicts.length > 0 && <details className="mt-2 text-left text-xs"><summary>Versiones recuperadas ({mirror.baseline.conflicts.length})</summary>{mirror.baseline.conflicts.map((entry, index) => <button key={index} className="mt-2 block underline" onClick={async () => {
            const item = entry as { key?: string; blob?: { hash: string } }
            let blob: Blob
            if (item.blob) {
              const response = await fetch(`/pizarra/api/cooperation/spheres/${sphere.id}/files/${item.blob.hash}`)
              if (!response.ok) { setError('No se pudo recuperar esa versión. Reintentá con conexión.'); return }
              blob = await response.blob()
            } else blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob), link = document.createElement('a')
            link.href = url; link.download = item.blob ? item.key?.split('/').at(-1) || 'version-recuperada' : 'version-recuperada.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
          }}>Descargar versión {index + 1}</button>)}</details>}
        </div>
      })}</div>
      {state.deletions.filter(d => d.decision === 'wait' && state.mirrors[d.sphereId]?.binding.groupId === group.id).map(pending => <button key={pending.id} className="block text-sm text-muted-foreground underline" onClick={() => window.dispatchEvent(new CustomEvent('cursado-cooperation-review', { detail: { pending, open: () => onOpen(state.mirrors[pending.sphereId].binding.subjectId, group.id) } }))}>{pending.label} · eliminación pendiente</button>)}
    </section>)}
    {invite && <div className="fixed inset-0 z-[250] grid place-items-center bg-black/30 p-4"><CooperationInvitation sphere={invite} onClose={() => setInvite(null)} onAccepted={() => setInvite(null)} /></div>}
  </section>
}
export function CooperationRuntime() {
  const state = useCooperation()
  const [review, setReview] = useState<{ pending: PendingDeletion; open?: () => void } | null>(null)
  const [error, setError] = useState('')
  const [invitation, setInvitation] = useState<CooperativeSphere | null>(null)
  useEffect(() => {
    if (isNativeReadOnly()) return
    const reviewElement = (event: Event) => { setError(''); setReview((event as CustomEvent).detail) }
    window.addEventListener('cursado-cooperation-review', reviewElement)
    const stop = startCooperationBackground()
    return () => { stop(); window.removeEventListener('cursado-cooperation-review', reviewElement) }
  }, [])
  useEffect(() => {
    if (review) return
    const pending = state.deletions.find(d => d.decision === 'wait' && !d.notified)
    if (pending) { setReview({ pending }); void notifyCooperationDeletion(pending.id) }
  }, [state, review])
  useEffect(() => {
    if (invitation || review) return
    const sphere = state.groups.flatMap(g => g.spheres).find(s => s.ready !== false && s.created_by !== state.userId && !state.mirrors[s.id] && !(state.dismissedSpheres || []).includes(s.id))
    if (sphere) { setError(''); setInvitation(sphere) }
  }, [state, invitation, review])
  if (invitation && !review) return <div className="fixed inset-0 z-[250] grid place-items-center bg-black/30 p-4"><CooperationInvitation sphere={invitation} onClose={() => { void dismissCooperationSphere(invitation.id); setInvitation(null) }} onAccepted={() => setInvitation(null)} /></div>
  if (!review) {
    const transfers = Object.values(state.mirrors).filter(m => m.transfer || m.error)
    if (!transfers.length && !(state.error && state.groups.length)) return null
    return <aside aria-label="Sincronización cooperativa" className="fixed bottom-4 left-4 z-[240] max-w-sm space-y-2 rounded-xl border bg-background p-3 text-sm text-foreground shadow-lg">
      {state.error && <p role="alert">{state.error}</p>}
      {transfers.map(m => <div key={m.binding.id}>
        <strong>{m.binding.name}</strong>
        {m.error ? <p role="alert">{m.error} <button className="underline" onClick={()=>void synchronizeCooperation()}>Reintentar</button></p>
          : <p role="status">{m.metadataReady && 'Metadatos disponibles. '}{m.transfer?.phase === 'uploading' ? 'Subiendo' : 'Descargando'} en segundo plano: {m.transfer?.completed}/{m.transfer?.total} archivos.</p>}
      </div>)}
    </aside>
  }
  const decide = async (decision: 'wait' | 'keep' | 'delete') => {
    try { await decideCooperationDeletion(review.pending.id, decision); setReview(null); setError('') } catch (reason) { setError((reason as Error).message) }
  }
  return <div className="fixed inset-0 z-[250] grid place-items-center bg-black/30 p-4"><section role="dialog" aria-modal="true" aria-label="Elemento eliminado" className="w-full max-w-md space-y-4 rounded-xl border bg-background p-6 text-foreground shadow-xl">
    <p>Se eliminó {review.pending.label}. ¿Querés confirmarlo?</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-4">
      <button onClick={() => void decide('wait')}>Esperar</button>
      {review.open && <button onClick={() => { const open = review.open; setReview(null); open?.() }}>Ver</button>}
      <button onClick={() => void decide('keep')}>Guardar</button>
      <button onClick={() => void decide('delete')}>{review.open ? 'Eliminar' : 'Confirmar'}</button>
    </div>
  </section></div>
}
