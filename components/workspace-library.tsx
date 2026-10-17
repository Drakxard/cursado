'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Share2, X, RefreshCw, QrCode, FolderOpen } from 'lucide-react'
import { libraryOwnerApi, libraryRoot, publishLibrary, readLibraryState, type PublicationProgress } from '@/lib/client/workspace-library'
import { getReadyInscreenConfigToken, loadServicesFile, loadWorkspaceHandle, persistServicesFile, pickWorkspaceRootHandle, requestWorkspacePermission, setReadyInscreenConfigToken, setReadyWorkspaceHandle } from '@/lib/local-workspace-client'

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
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [configured, setConfigured] = useState(false)
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
    const services = await loadServicesFile(handle)
    setReadyInscreenConfigToken(services?.inscreenToken || '')
    let ready = false
    if (services?.inscreenToken) {
      const response = await fetch('/api/inscreen/config/status', { headers: { 'x-inscreen-config-token': services.inscreenToken }, cache: 'no-store' })
      const status = await response.json()
      if (!response.ok) throw new Error(status.error || 'No se pudieron abrir los servicios.')
      ready = Boolean(status.services?.r2)
    }
    setConfigured(ready)
    const state = await readLibraryState(handle)
    setWorkspaceId(state?.workspaceId || ''); setPublishedAt(state?.publishedAt || '')
    if (state && ready) await refreshDevices(state.workspaceId)
  }
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); try { await work() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  async function chooseFolder() {
    await run(async () => {
      const stored = await loadWorkspaceHandle()
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
      if (!configured || Object.values(credentials).some(Boolean)) await saveCredentials()
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
    void run(async () => { const handle = await libraryRoot().catch(() => null); if (handle) await inspect(handle) })
    const interval = setInterval(() => { setNow(Date.now()); if (workspaceId) void refreshDevices(workspaceId).catch(() => {}) }, 5000)
    return () => clearInterval(interval)
    // Opening the panel loads services without prompting for filesystem permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId])
  return <>
    <button className="library-share" aria-label="Sincronizar dispositivos" onClick={() => setOpen(true)}><Share2 size={35} /></button>
    {open && <div className="library-overlay" onClick={() => setOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="library-title" className="library-panel" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <header><h1 id="library-title">Sincronizá tus dispositivos</h1><button aria-label="Cerrar" onClick={() => setOpen(false)}><X /></button></header>
      <p>Publicá tu biblioteca y llevala en InScreen. Podrás leerla también sin internet.</p>
      <button disabled={busy} onClick={() => void chooseFolder()}><FolderOpen size={18} /> {root ? root.name : 'Elegir carpeta de Cursado'}</button>
      {!configured && <p>Necesitás conectar Cloudflare R2 para subir tus recursos.</p>}
      <details open={!configured}><summary>{configured ? 'R2 conectado · Cambiar configuración' : 'Configurar Cloudflare R2'}</summary><div className="library-fields">{Object.keys(credentials).map(key => <label key={key}>{({ R2_BUCKET_NAME: 'Bucket', R2_ENDPOINT: 'Endpoint S3', R2_ACCESS_KEY_ID: 'Access Key ID', R2_SECRET_ACCESS_KEY: 'Secret Access Key' } as Record<string, string>)[key]}<input type={key.includes('KEY') ? 'password' : 'text'} autoComplete="off" value={credentials[key as keyof typeof credentials]} onChange={e => setCredentials(current => ({ ...current, [key]: e.target.value }))} /></label>)}</div></details>
      <button className="library-primary" disabled={busy || !root} onClick={() => void upload()}><RefreshCw size={18} /> {busy ? 'Publicando…' : publishedAt ? 'Actualizar ahora' : 'Comenzar a subir'}</button>
      {progress && <div role="status"><p>{progress.message}</p>{progress.total > 0 && <progress max={progress.total} value={progress.done} />}{progress.error && <p className="library-error">{progress.error}</p>}</div>}
      {error && <p role="alert" className="library-error">{error}</p>}
      {publishedAt && <><p>Última publicación: {new Date(publishedAt).toLocaleString('es-AR')}</p><div className="library-devices"><div><h2>Actuales</h2>{devices.filter(d => d.enabled).length === 0 && <p>Todavía no hay dispositivos vinculados.</p>}{devices.filter(d => d.enabled).map(d => <div className="library-device" key={d.deviceId}><span>{d.name}<small>{new Date(d.createdAt).toLocaleDateString('es-AR')}</small></span><button disabled={busy} onClick={() => void run(async () => { await libraryOwnerApi('devices/revoke', { workspaceId, deviceId: d.deviceId }); await refreshDevices(workspaceId) })}>Desvincular</button></div>)}</div><div className="library-qr"><h2>Nuevos con QR</h2>{qr && now < expires ? <><img src={qr} alt="QR para vincular InScreen" /><p>Vence en {Math.ceil((expires - now) / 1000)} s</p></> : <p>Generá un QR y escanealo desde InScreen.</p>}<button disabled={busy} onClick={() => void run(() => createQr())}><QrCode size={18} /> Generar nuevo QR</button></div></div></>}
    </section></div>}
  </>
}
