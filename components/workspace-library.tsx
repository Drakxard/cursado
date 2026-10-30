'use client'
import { useEffect, useRef, useState } from 'react'
import { createIdleSync } from '@/lib/client/idle-sync'
import { startVisibleTask } from '@/lib/client/visible-task'
import QRCode from 'qrcode'
import { Share2, X, RefreshCw, QrCode, FolderOpen } from 'lucide-react'
import { R2SetupGuide } from '@/components/r2-setup-guide'
import { CooperationGroupForm } from '@/components/cooperation'
import { libraryConnection } from '@/lib/client/workspace-library-connection'
import { getLibraryPublicationProgress, libraryOwnerApi, libraryRoot, publishLibrary, readLibraryState, type PublicationProgress } from '@/lib/client/workspace-library'
import { getReadyInscreenConfigToken, loadServicesFile, loadWorkspaceHandle, persistServicesFile, pickWorkspaceRootHandle, queryWorkspacePermission, requestWorkspacePermission, setReadyInscreenConfigToken, setReadyWorkspaceHandle } from '@/lib/local-workspace-client'

export function WorkspaceLibraryPublisher() {
  useEffect(() => {
    let disposed = false
    const sync = async () => {
      if (disposed || !navigator.onLine) return false
      const root = await libraryRoot()
      if (!disposed && (await readLibraryState(root))?.enabled) await publishLibrary(root)
    }
    const scheduler = createIdleSync({ run: sync, storageKey: 'cursado-library-pending-sync' })
    const saved = () => scheduler.request()
    const channel = new BroadcastChannel('cursado-library-changes')
    channel.onmessage = saved
    window.addEventListener('cursado-workspace-saved', saved)
    window.addEventListener('online', saved)
    window.addEventListener('cursado-services-changed', saved)
    saved()
    return () => { disposed = true; scheduler.stop(); channel.close(); window.removeEventListener('cursado-workspace-saved', saved); window.removeEventListener('online', saved); window.removeEventListener('cursado-services-changed', saved) }
  }, [])
  return null
}

type Device = { deviceId: string; name: string; enabled: boolean; createdAt: string }
export function WorkspaceLibraryButton() {
  const [choice, setChoice] = useState<'choose' | 'cooperate' | 'devices'>('choose')
  const [open, setOpen] = useState(false), [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [configured, setConfigured] = useState<boolean | null>(null)
  const [editing, setEditing] = useState(false), [help, setHelp] = useState(false), [connectionSource, setConnectionSource] = useState('')
  const [helpStep, setHelpStep] = useState(0)
  const [publishedAt, setPublishedAt] = useState(''), [workspaceId, setWorkspaceId] = useState('')
  const [progress, setProgress] = useState<PublicationProgress | null>(null), [devices, setDevices] = useState<Device[]>([])
  const [qr, setQr] = useState(''), [expires, setExpires] = useState(0), [now, setNow] = useState(Date.now())
  const [credentials, setCredentials] = useState({ R2_BUCKET_NAME: '', R2_ENDPOINT: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' })
  const [screen, setScreen] = useState<'setup' | 'sync' | 'devices'>('setup')
  const activeWorkspace = useRef('')
  function completed(manifest: { workspaceId: string; publishedAt: string; files?: { size: number }[] }) {
    activeWorkspace.current = manifest.workspaceId
    setWorkspaceId(manifest.workspaceId); setPublishedAt(manifest.publishedAt)
    const bytes = (manifest.files || []).reduce((total, file) => total + file.size, 0)
    setProgress({ phase: 'complete', message: 'Biblioteca sincronizada', done: manifest.files?.length || 0, total: manifest.files?.length || 0, bytesDone: bytes, bytesTotal: bytes })
    setScreen('devices')
  }
  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<PublicationProgress>).detail
      if (next.workspaceId && activeWorkspace.current && next.workspaceId !== activeWorkspace.current) return
      setProgress(next)
      if (next.phase === 'complete' && next.workspaceId && next.publishedAt) {
        setWorkspaceId(next.workspaceId); setPublishedAt(next.publishedAt); setScreen('devices')
      } else if (next.phase) setScreen('sync')
    }
    window.addEventListener('cursado-library-progress', update)
    return () => window.removeEventListener('cursado-library-progress', update)
  }, [])
  async function inspect(handle: FileSystemDirectoryHandle) {
    setRoot(handle); setReadyWorkspaceHandle(handle)
    setConfigured(null); setEditing(false)
    setScreen('setup'); setProgress(null); setQr('')
    const connection = await libraryConnection(handle)
    const ready = connection.configured
    setConfigured(ready); setConnectionSource(connection.source)
    const state = await readLibraryState(handle)
    activeWorkspace.current = state?.workspaceId || ''
    setWorkspaceId(state?.workspaceId || ''); setPublishedAt(state?.publishedAt || '')
    const live = getLibraryPublicationProgress()
    if (state && ready && (state.publishedAt || live?.workspaceId === state.workspaceId)) {
      setScreen('sync')
      setProgress(live?.workspaceId === state.workspaceId ? live : { phase: 'preparing', message: 'Comprobando los cambios guardados…', done: 0, total: 0 })
      if (live?.workspaceId === state.workspaceId && live.phase === 'error' && !state.publishedAt) return
      completed(await publishLibrary(handle))
    }
  }
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); try { await work() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  async function chooseFolder() {
    await run(async () => {
      const stored = root ? null : await loadWorkspaceHandle()
      const handle = stored && await requestWorkspacePermission(stored, 'readwrite') === 'granted' ? stored : await pickWorkspaceRootHandle()
      await inspect(handle)
    })
  }
  async function refreshDevices(id: string) { const result = await libraryOwnerApi('devices', { workspaceId: id }, 'GET'); setDevices(result.devices) }
  async function saveCredentials() {
    if (!root) throw new Error('Elegí tu carpeta primero.')
    const response = await fetch('/api/inscreen/config/seal', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(getReadyInscreenConfigToken() ? { 'x-inscreen-config-token': getReadyInscreenConfigToken() } : {}) }, body: JSON.stringify(credentials) })
    const sealed = await response.json()
    if (!response.ok || !sealed.token || !sealed.services?.r2) throw new Error(sealed.error || 'Completá los cuatro campos de R2.')
    const current = await loadServicesFile(root)
    await persistServicesFile(root, { inscreenToken: sealed.token, driveToken: current?.driveToken || '', seedFingerprint: sealed.seedFingerprint, validatedAt: sealed.validatedAt })
    setReadyInscreenConfigToken(sealed.token); setConfigured(true)
    setCredentials({ R2_BUCKET_NAME: '', R2_ENDPOINT: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' })
    window.dispatchEvent(new Event('cursado-services-changed'))
  }
  async function upload() {
    await run(async () => {
      if (!root) throw new Error('Elegí la carpeta que contiene tus materiales.')
      const connection = await libraryConnection(root)
      setProgress(null)
      if (!connection.configured || editing && Object.values(credentials).some(Boolean)) await saveCredentials()
      else { setConfigured(true); setConnectionSource(connection.source) }
      setEditing(false)
      setScreen('sync'); setError(''); setProgress({ phase: 'preparing', message: 'Preparando la sincronización…', done: 0, total: 0 })
      const manifest = await publishLibrary(root, { enable: true })
      completed(manifest)
    })
  }
  async function createQr(id = workspaceId) {
    const result = await libraryOwnerApi('pairing/create', { workspaceId: id })
    setQr(await QRCode.toDataURL(result.pairingUri, { width: 400, margin: 2, errorCorrectionLevel: 'L' })); setExpires(result.expiresAt); setNow(Date.now())
  }
  useEffect(() => {
    if (!open || choice !== 'devices') return
    setConfigured(null); setEditing(false); setScreen('setup')
    void run(async () => {
      const handle = await loadWorkspaceHandle()
      if (handle && await queryWorkspacePermission(handle, 'readwrite') === 'granted') await inspect(handle)
      else { const connection = await libraryConnection(); setConfigured(connection.configured); setConnectionSource(connection.source) }
    })
    // Opening the panel loads services without prompting for filesystem permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, choice])
  useEffect(() => {
    if (!open || choice !== 'devices') return
    return startVisibleTask(async () => { setNow(Date.now()); if (workspaceId) await refreshDevices(workspaceId).catch(() => {}) }, 5000)
  }, [open, workspaceId, choice])
  useEffect(() => {
    if (!open || choice !== 'devices' || screen !== 'devices' || !workspaceId) return
    void run(async () => { await refreshDevices(workspaceId); if (location.protocol === 'https:' && (!qr || Date.now() >= expires)) await createQr(workspaceId) })
    // QR creation follows the completed publication, never byte-transfer progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, screen, workspaceId, choice])
  const totalBytes = progress?.bytesTotal || 0, sentBytes = Math.min(progress?.bytesDone || 0, totalBytes)
  const percent = totalBytes > 0 ? Math.min(99, Math.floor(sentBytes / totalBytes * 100)) : null
  const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} MB`
  return <>
    <button className="library-share" aria-label="Compartir" onClick={() => { setChoice('choose'); setOpen(true) }}><Share2 size={35} /></button>
    {open && choice !== 'devices' && <div className="library-overlay" onClick={() => setOpen(false)}><section role="dialog" aria-modal="true" aria-label="Compartir" className="library-panel" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <header><h1>{choice === 'choose' ? 'Compartir' : 'Estudio cooperativo'}</h1><button aria-label="Cerrar" onClick={() => setOpen(false)}><X /></button></header>
      {choice === 'choose' ? <div className="grid gap-6 py-8 sm:grid-cols-2">
        <button className="rounded-xl border p-6 text-center" onClick={() => setChoice('cooperate')}><span className="block text-xl">Estudio cooperativo</span><span aria-hidden="true" className="mt-6 flex justify-center gap-2 text-2xl"><span className="rounded-[50%] border-2 border-gray-500 px-4 py-2">A</span><span className="rounded-[50%] border-2 border-green-500 px-3 py-2 text-green-600">B</span><span className="rounded-[50%] border-2 border-purple-500 px-4 py-2 text-purple-600">C</span></span></button>
        <button className="rounded-xl border p-6 text-center" onClick={() => setChoice('devices')}><span className="block text-xl">Sincronizar dispositivos</span><span aria-hidden="true" className="mt-6 block text-5xl">▱ ⇄ ▯</span></button>
      </div> : <CooperationGroupForm onCreated={() => setOpen(false)} />}
    </section></div>}
    {open && choice === 'devices' && <div className="library-overlay" onClick={() => setOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="library-title" className="library-panel" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <header><h1 id="library-title">{screen === 'sync' ? 'Sincronizando tu biblioteca' : 'Sincronizá tus dispositivos'}</h1><div className="library-header-actions"><button aria-label="Cómo conseguir y configurar R2" title="Ayuda para conectar R2" onClick={() => { setHelpStep(0); setHelp(true) }}>❔</button><button aria-label="Cerrar" onClick={() => setOpen(false)}><X /></button></div></header>
      <div key={screen} className={`library-stage library-stage-${screen}`}>
      {screen === 'setup' && <>
      <p>Publicá tu biblioteca y llevala en InScreen. Podrás leerla también sin internet.</p>
      <button disabled={busy} onClick={() => void chooseFolder()}><FolderOpen size={18} /> {root ? root.name : 'Elegir carpeta de Cursado'}</button>
      {configured === null && busy && <p role="status">Buscando tu conexión guardada…</p>}
      {configured && <div className="library-connected"><div><strong>✓ R2 conectado</strong><p>{connectionSource === 'workspace' ? 'Usando la conexión guardada en esta carpeta.' : 'Usando la conexión que ya tenías en Cursado.'}</p></div><button disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Cancelar cambios' : 'Cambiar configuración'}</button></div>}
      {configured && <p className="library-field-hint">Al publicar, buscamos la sincronización anterior de este bucket y recuperamos lo que falte en tu carpeta. Conservamos tus versiones locales y la organización por materia y semana.</p>}
      {configured === false && !root && <p>Elegí tu carpeta para buscar la conexión que ya tenías guardada.</p>}
      {configured === false && root && <p>No encontramos R2 en esta carpeta. Si ya lo configuraste, elegí la carpeta que usabas en Estudio. También podés conectarlo acá con la ayuda ❔.</p>}
      {(configured === false && root || editing) && <div className="library-config"><h2>Conectar Cloudflare R2</h2><div className="library-fields">{Object.keys(credentials).map(key => <label key={key}>{({ R2_BUCKET_NAME: 'Bucket', R2_ENDPOINT: 'Endpoint S3', R2_ACCESS_KEY_ID: 'Access Key ID', R2_SECRET_ACCESS_KEY: 'Secret Access Key' } as Record<string, string>)[key]}<input name={`cursado-library-${key.toLowerCase()}`} type={key.includes('KEY') ? 'password' : key === 'R2_ENDPOINT' ? 'url' : 'text'} autoComplete={key.includes('KEY') ? 'new-password' : 'off'} spellCheck={false} autoCapitalize="none" placeholder={key === 'R2_ENDPOINT' ? 'https://TU_ACCOUNT_ID.r2.cloudflarestorage.com' : editing ? 'Vacío conserva el valor actual' : ''} value={credentials[key as keyof typeof credentials]} onChange={e => setCredentials(current => ({ ...current, [key]: e.target.value }))} /></label>)}</div><p className="library-field-hint">El Endpoint S3 es una dirección que comienza con https://; lo encontrás junto a las claves de R2.</p></div>}
      <button className="library-primary" disabled={busy || !root || configured === null} onClick={() => void upload()}><RefreshCw size={18} /> {busy ? 'Procesando…' : publishedAt ? 'Actualizar ahora' : 'Comenzar a subir'}</button>
      </>}
      {screen === 'sync' && <div className="library-sync-view" aria-live="polite">
        <p>{progress?.phase === 'recovering' ? 'Recuperando la biblioteca anterior de R2' : progress?.phase === 'verifying' ? 'Verificando y guardando la publicación' : progress?.error ? 'La sincronización necesita un reintento' : 'Preparando tus recursos para otros dispositivos'}</p>
        <strong className="library-percentage">{percent === null ? <RefreshCw size={48} className={progress?.error ? '' : 'library-spin'} /> : `${percent} %`}</strong>
        <progress aria-label="Avance de sincronización" max={100} {...(percent !== null ? { value: percent } : {})} />
        {totalBytes > 0 && <div className="library-sync-metrics"><div><strong>{mb(sentBytes)}</strong><span>{progress?.phase === 'recovering' ? 'procesados de la biblioteca anterior' : 'enviados o reutilizados en R2'}</span></div><div><strong>{mb(Math.max(0, totalBytes - sentBytes))}</strong><span>pendientes de {mb(totalBytes)}</span></div></div>}
        {progress && progress.total > 0 && <p>{progress.done} de {progress.total} archivos · faltan {Math.max(0, progress.total - progress.done)}</p>}
        <p className="library-current-file">{progress?.message || 'Preparando la sincronización…'}</p>
        {progress?.error && <p role="alert" className="library-error">{progress.error}</p>}
        {!progress?.error && <small>El QR aparecerá al completar y verificar toda la sincronización.</small>}
        {progress?.error && <div className="library-sync-actions"><button className="library-primary" disabled={busy} onClick={() => void upload()}><RefreshCw size={18} />Reintentar sincronización</button><button disabled={busy} onClick={() => { setScreen('setup'); setError(''); setProgress(null) }}>Revisar configuración</button></div>}
      </div>}
      {error && error !== progress?.error && <p role="alert" className="library-error">{error}</p>}
      {progress?.help === 'cors' && <button onClick={() => { setHelpStep(3); setHelp(true) }}>❔ Revisar permisos CORS</button>}
      {screen === 'devices' && <><p className="library-sync-complete">✓ 100 % sincronizado · {mb(totalBytes)}</p><div className="library-devices"><div><h2>Actuales</h2>{devices.filter(d => d.enabled).length === 0 && <p>Todavía no hay dispositivos vinculados.</p>}{devices.filter(d => d.enabled).map(d => <div className="library-device" key={d.deviceId}><span>{d.name}<small>{new Date(d.createdAt).toLocaleDateString('es-AR')}</small></span><button disabled={busy} onClick={() => void run(async () => { await libraryOwnerApi('devices/revoke', { workspaceId, deviceId: d.deviceId }); await refreshDevices(workspaceId) })}>Desvincular</button></div>)}</div><div className="library-qr"><h2>Nuevos con QR</h2>{qr && now < expires ? <><img src={qr} alt="QR para vincular InScreen" /><p>Escanealo con InScreen · vence en {Math.ceil((expires - now) / 1000)} s</p></> : <p>{busy ? 'Preparando el QR…' : 'Generá un QR y escanealo desde InScreen.'}</p>}<button disabled={busy} onClick={() => void run(() => createQr())}><QrCode size={18} /> Generar nuevo QR</button></div></div><footer className="library-ready-actions"><small>Última publicación: {new Date(publishedAt).toLocaleString('es-AR')}</small><div><button disabled={busy} onClick={() => { setScreen('setup'); setError(''); setProgress(null) }}>Configuración</button><button disabled={busy} onClick={() => void upload()}><RefreshCw size={18} />Actualizar ahora</button></div></footer></>}
      </div>
    </section></div>}
    <R2SetupGuide open={help && open} onOpenChange={setHelp} initialStep={helpStep} />
  </>
}
