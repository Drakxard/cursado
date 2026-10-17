'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Share2, X, RefreshCw, QrCode, FolderOpen } from 'lucide-react'
import { R2SetupGuide } from '@/components/r2-setup-guide'
import { libraryConnection } from '@/lib/client/workspace-library-connection'
import { libraryOwnerApi, libraryRoot, publishLibrary, readLibraryState, type PublicationProgress } from '@/lib/client/workspace-library'
import { getReadyInscreenConfigToken, loadServicesFile, loadWorkspaceHandle, persistServicesFile, pickWorkspaceRootHandle, queryWorkspacePermission, requestWorkspacePermission, setReadyInscreenConfigToken, setReadyWorkspaceHandle } from '@/lib/local-workspace-client'

export function WorkspaceLibraryPublisher() {
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      if (disposed || !navigator.onLine) return
      void libraryRoot().then(async root => { if ((await readLibraryState(root))?.enabled) await publishLibrary(root) }).catch(() => {})
    }
    const saved = () => { clearTimeout(timer); timer = setTimeout(sync, 2000) }
    const channel = new BroadcastChannel('cursado-library-changes')
    channel.onmessage = saved
    window.addEventListener('cursado-workspace-saved', saved)
    window.addEventListener('online', sync)
    window.addEventListener('cursado-services-changed', sync)
    const interval = setInterval(sync, 45000)
    sync()
    return () => { disposed = true; clearTimeout(timer); clearInterval(interval); channel.close(); window.removeEventListener('cursado-workspace-saved', saved); window.removeEventListener('online', sync); window.removeEventListener('cursado-services-changed', sync) }
  }, [])
  return null
}

type Device = { deviceId: string; name: string; enabled: boolean; createdAt: string }
export function WorkspaceLibraryButton() {
  const [open, setOpen] = useState(false), [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [configured, setConfigured] = useState<boolean | null>(null)
  const [editing, setEditing] = useState(false), [help, setHelp] = useState(false), [connectionSource, setConnectionSource] = useState('')
  const [helpStep, setHelpStep] = useState(0)
  const [publishedAt, setPublishedAt] = useState(''), [workspaceId, setWorkspaceId] = useState('')
  const [progress, setProgress] = useState<PublicationProgress | null>(null), [devices, setDevices] = useState<Device[]>([])
  const [qr, setQr] = useState(''), [expires, setExpires] = useState(0), [now, setNow] = useState(Date.now())
  const [credentials, setCredentials] = useState({ R2_BUCKET_NAME: '', R2_ENDPOINT: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' })
  useEffect(() => {
    const update = (event: Event) => setProgress((event as CustomEvent<PublicationProgress>).detail)
    window.addEventListener('cursado-library-progress', update)
    return () => window.removeEventListener('cursado-library-progress', update)
  }, [])
  async function inspect(handle: FileSystemDirectoryHandle) {
    setRoot(handle); setReadyWorkspaceHandle(handle)
    setConfigured(null); setEditing(false)
    const connection = await libraryConnection(handle)
    const ready = connection.configured
    setConfigured(ready); setConnectionSource(connection.source)
    const state = await readLibraryState(handle)
    setWorkspaceId(state?.workspaceId || ''); setPublishedAt(state?.publishedAt || '')
    if (state && ready) await refreshDevices(state.workspaceId)
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
      const manifest = await publishLibrary(root, { enable: true })
      setWorkspaceId(manifest.workspaceId); setPublishedAt(manifest.publishedAt)
      await refreshDevices(manifest.workspaceId)
      if (location.protocol === 'https:') await createQr(manifest.workspaceId)
    })
  }
  async function createQr(id = workspaceId) {
    const result = await libraryOwnerApi('pairing/create', { workspaceId: id })
    setQr(await QRCode.toDataURL(result.pairingUri, { width: 400, margin: 2, errorCorrectionLevel: 'L' })); setExpires(result.expiresAt); setNow(Date.now())
  }
  useEffect(() => {
    if (!open) return
    setConfigured(null); setEditing(false)
    void run(async () => {
      const handle = await loadWorkspaceHandle()
      if (handle && await queryWorkspacePermission(handle, 'readwrite') === 'granted') await inspect(handle)
      else { const connection = await libraryConnection(); setConfigured(connection.configured); setConnectionSource(connection.source) }
    })
    // Opening the panel loads services without prompting for filesystem permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (!open) return
    const interval = setInterval(() => { setNow(Date.now()); if (workspaceId) void refreshDevices(workspaceId).catch(() => {}) }, 5000)
    return () => clearInterval(interval)
  }, [open, workspaceId])
  return <>
    <button className="library-share" aria-label="Sincronizar dispositivos" onClick={() => setOpen(true)}><Share2 size={35} /></button>
    {open && <div className="library-overlay" onClick={() => setOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="library-title" className="library-panel" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <header><h1 id="library-title">Sincronizá tus dispositivos</h1><div className="library-header-actions"><button aria-label="Cómo conseguir y configurar R2" title="Ayuda para conectar R2" onClick={() => { setHelpStep(0); setHelp(true) }}>❔</button><button aria-label="Cerrar" onClick={() => setOpen(false)}><X /></button></div></header>
      <p>Publicá tu biblioteca y llevala en InScreen. Podrás leerla también sin internet.</p>
      <button disabled={busy} onClick={() => void chooseFolder()}><FolderOpen size={18} /> {root ? root.name : 'Elegir carpeta de Cursado'}</button>
      {configured === null && busy && <p role="status">Buscando tu conexión guardada…</p>}
      {configured && <div className="library-connected"><div><strong>✓ R2 conectado</strong><p>{connectionSource === 'workspace' ? 'Usando la conexión guardada en esta carpeta.' : 'Usando la conexión que ya tenías en Cursado.'}</p></div><button disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Cancelar cambios' : 'Cambiar configuración'}</button></div>}
      {configured === false && !root && <p>Elegí tu carpeta para buscar la conexión que ya tenías guardada.</p>}
      {configured === false && root && <p>No encontramos R2 en esta carpeta. Si ya lo configuraste, elegí la carpeta que usabas en Estudio. También podés conectarlo acá con la ayuda ❔.</p>}
      {(configured === false && root || editing) && <div className="library-config"><h2>Conectar Cloudflare R2</h2><div className="library-fields">{Object.keys(credentials).map(key => <label key={key}>{({ R2_BUCKET_NAME: 'Bucket', R2_ENDPOINT: 'Endpoint S3', R2_ACCESS_KEY_ID: 'Access Key ID', R2_SECRET_ACCESS_KEY: 'Secret Access Key' } as Record<string, string>)[key]}<input name={`cursado-library-${key.toLowerCase()}`} type={key.includes('KEY') ? 'password' : key === 'R2_ENDPOINT' ? 'url' : 'text'} autoComplete={key.includes('KEY') ? 'new-password' : 'off'} spellCheck={false} autoCapitalize="none" placeholder={key === 'R2_ENDPOINT' ? 'https://TU_ACCOUNT_ID.r2.cloudflarestorage.com' : editing ? 'Vacío conserva el valor actual' : ''} value={credentials[key as keyof typeof credentials]} onChange={e => setCredentials(current => ({ ...current, [key]: e.target.value }))} /></label>)}</div><p className="library-field-hint">El Endpoint S3 es una dirección que comienza con https://; lo encontrás junto a las claves de R2.</p></div>}
      <button className="library-primary" disabled={busy || !root || configured === null} onClick={() => void upload()}><RefreshCw size={18} /> {busy ? 'Procesando…' : publishedAt ? 'Actualizar ahora' : 'Comenzar a subir'}</button>
      {progress && <div role="status"><p>{progress.message}</p>{progress.total > 0 && <progress max={progress.total} value={progress.done} />}{progress.error && <p className="library-error">{progress.error}</p>}</div>}
      {error && error !== progress?.error && <p role="alert" className="library-error">{error}</p>}
      {progress?.help === 'cors' && <button onClick={() => { setHelpStep(3); setHelp(true) }}>❔ Revisar permisos CORS</button>}
      {publishedAt && <><p>Última publicación: {new Date(publishedAt).toLocaleString('es-AR')}</p><div className="library-devices"><div><h2>Actuales</h2>{devices.filter(d => d.enabled).length === 0 && <p>Todavía no hay dispositivos vinculados.</p>}{devices.filter(d => d.enabled).map(d => <div className="library-device" key={d.deviceId}><span>{d.name}<small>{new Date(d.createdAt).toLocaleDateString('es-AR')}</small></span><button disabled={busy} onClick={() => void run(async () => { await libraryOwnerApi('devices/revoke', { workspaceId, deviceId: d.deviceId }); await refreshDevices(workspaceId) })}>Desvincular</button></div>)}</div><div className="library-qr"><h2>Nuevos con QR</h2>{qr && now < expires ? <><img src={qr} alt="QR para vincular InScreen" /><p>Vence en {Math.ceil((expires - now) / 1000)} s</p></> : <p>Generá un QR y escanealo desde InScreen.</p>}<button disabled={busy} onClick={() => void run(() => createQr())}><QrCode size={18} /> Generar nuevo QR</button></div></div></>}
    </section></div>}
    <R2SetupGuide open={help && open} onOpenChange={setHelp} initialStep={helpStep} />
  </>
}
