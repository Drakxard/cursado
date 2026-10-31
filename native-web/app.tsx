import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SubjectWheel } from '@/components/subject-wheel'
import { StudyImportantTasks } from '@/components/study-important-tasks'
import { NativeWorkspaceProvider } from '@/components/local-workspace-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import { nativeSnapshot, nativeWorkspaceRoot } from '@/lib/native-workspace'
import { setReadyWorkspaceHandle } from '@/lib/local-workspace-client'
import { SUBJECT_IDS } from '@/lib/subjects'
import { usePathname, useSearchParams, navigate } from './navigation'
import { isStudyPath } from '@/lib/study-location'
import { SynthesisClient } from '@/app/sintesis/synthesis-client'
import { parseSynthesisContext } from '@/lib/synthesis-context'
import { NativePdfLauncher, PracticeViewerClient } from '@/app/practice/viewer/practice-viewer-client'
import homeStyles from '@/app/home.module.css'
import { HomeChoices } from '@/components/home-choices'
import { handleLocalApiRequest } from '@/components/local-fetch-interceptor'
import { Home, MoreVertical, RefreshCw, QrCode, Unlink } from 'lucide-react'
import { HomeShortcut } from '@/components/home-shortcut'

class ErrorBoundary extends Component<{children: React.ReactNode}, {error: string}> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <main role="alert" style={{padding: 24}}><p>{this.state.error}</p><button onClick={() => location.reload()}>Reintentar</button></main> : this.props.children }
}
function NativeHome() {
  const touch = useRef<{x:number;y:number} | null>(null)
  return <main className={homeStyles.home} style={{touchAction:'pan-y'}}
    onTouchStart={event => { touch.current = event.touches.length === 1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY} : null }}
    onTouchCancel={() => { touch.current = null }}
    onTouchEnd={event => {
      const start = touch.current; touch.current = null
      if (!start || !event.changedTouches.length) return
      const dx = event.changedTouches[0].clientX-start.x, dy = event.changedTouches[0].clientY-start.y
      if (dx > 80 && dx > Math.abs(dy)*1.5) window.CursadoNative?.home?.()
    }}><HomeChoices /></main>
}
function Routes() {
  const path = usePathname(), params = useSearchParams()
  const session = { email: 'native-reader@app.local', isAdmin: false, allowedSubjectIds: SUBJECT_IDS, expiresAtMs: Number.MAX_SAFE_INTEGER }
  if (isStudyPath(path)) return <StudyImportantTasks><SubjectWheel authSession={session} initialSearchParams={Object.fromEntries(params)} /></StudyImportantTasks>
  if (path === '/sintesis') return <SynthesisClient key={`${params.get('subjectId')}:${params.get('weekNumber')}`} context={parseSynthesisContext(params.get('subjectId'), params.get('weekNumber'))} legacyReturnToken={params.get('returnToken') || ''} />
  if (path === '/practice/viewer') return <PracticeViewerClient materialId={Number(params.get('materialId'))} returnToken={params.get('returnToken') || undefined} />
  if (path === '/native/pdf') return <NativePdfLauncher workspaceFileId={params.get('workspaceFileId') || ''} />
  if (path === '/pizarra/' || path === '/pizarra') return <iframe title="Pizarra" src="/pizarra/index.html" style={{width:'100%',height:'100dvh',border:0}} />
  return <NativeHome />
}
function App() {
  const [snapshot, setSnapshot] = useState(() => nativeSnapshot())
  const [message, setMessage] = useState('')
  const root = useMemo(() => snapshot.linked && snapshot.manifest ? nativeWorkspaceRoot(snapshot) : null, [snapshot])
  useEffect(() => { window.LibraryReload = () => setSnapshot(nativeSnapshot()); return () => { delete window.LibraryReload } }, [])
  useEffect(() => {
    window.LibraryMessage = setMessage
    const click = (event: MouseEvent) => { const link = (event.target as Element)?.closest<HTMLAnchorElement>('a[href]'); if (event.defaultPrevented || !link || event.ctrlKey || event.metaKey) return; const url = new URL(link.href,location.href); event.preventDefault(); window.open(url.href) }
    const back = (event: Event) => queueMicrotask(() => {
      if (event.defaultPrevented) return
      if (location.pathname === '/') window.CursadoNative!.home?.()
      else history.back()
    })
    const fileError = (event: Event) => setMessage((event as CustomEvent<string>).detail)
    const pdfOpened = () => {
      if (!['/native/pdf','/practice/viewer'].includes(location.pathname)) return
      if (history.length > 1) history.back()
      else navigate('/estudio',true)
    }
    window.addEventListener('cursado-native-pdf-opened',pdfOpened)
    document.addEventListener('click',click); window.addEventListener('cursado-native-back',back)
    window.addEventListener('cursado-native-file-error',fileError)
    return () => {delete window.LibraryMessage;document.removeEventListener('click',click);window.removeEventListener('cursado-native-back',back);window.removeEventListener('cursado-native-file-error',fileError);window.removeEventListener('cursado-native-pdf-opened',pdfOpened)}
  }, [])
  if (!snapshot.linked) return <main style={{height:'100dvh',display:'grid',placeContent:'center'}}><button aria-label="Vincular con QR" title="Vincular con QR" onClick={() => window.CursadoNative!.pair()}><QrCode size={48}/></button></main>
  if (!snapshot.manifest) return <main style={{padding:24}}><p>Inventario pendiente de descarga.</p><button aria-label="Reintentar" title="Reintentar" onClick={() => window.CursadoNative!.refresh()}><RefreshCw size={20}/></button>{message && <p role="alert">{message}</p>}</main>
  if (!root) return null
  setReadyWorkspaceHandle(root)
  return <NativeWorkspaceProvider key={`${snapshot.manifest.workspaceId}:${snapshot.manifest.revision}`} rootHandle={root}><ThemeProvider attribute="data-theme" defaultTheme="daylight" enableSystem={false}><nav className="native-library-controls" aria-label="Navegación"><button aria-label="Inicio" title="Inicio" onClick={() => navigate('/')}><Home size={18} /></button><details><summary aria-label="Más opciones" title="Más opciones"><MoreVertical size={18} /></summary><button aria-label="Actualizar archivos" title="Actualizar archivos" onClick={() => window.CursadoNative!.refresh()}><RefreshCw size={18} /></button><button aria-label="Vincular otra biblioteca" title="Vincular otra biblioteca" onClick={() => window.CursadoNative!.pair()}><QrCode size={18} /></button><button aria-label="Quitar biblioteca" title="Quitar biblioteca" onClick={() => window.CursadoNative!.unlink()}><Unlink size={18} /></button></details></nav>{message && <p role="alert">{message}<button aria-label="Cerrar" onClick={() => setMessage('')}>×</button></p>}<Routes /><HomeShortcut /><Toaster /></ThemeProvider></NativeWorkspaceProvider>
}
declare global { interface Window { LibraryReload?: () => void; LibraryMessage?: (message: string) => void } }
// No application API is called from the offline entry. Reads use the native
// revision; this also prevents background migration/upload effects from escaping.
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.pathname.startsWith('/api/')) {
    const request = new Request(input instanceof Request ? input : url, init)
    if (request.method === 'GET') {
      try { const response = await handleLocalApiRequest(request); if (response) return response }
      catch(error) { return Response.json({error:error instanceof Error ? error.message : 'No se pudo abrir el archivo.'},{status:503}) }
    }
    return Response.json({ error:'Disponible únicamente desde la computadora.' }, { status: 403 })
  }
  return originalFetch(input, init)
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
window.open = (url) => {
  const target = new URL(String(url),location.href)
  if (target.origin === location.origin) {
    if (target.pathname === '/pdfjs/web/viewer.html') {
      const file = target.searchParams.get('workspaceFileId') || nativeSnapshot().manifest?.files.find(file=>`/files/${nativeSnapshot().manifest?.revision}/${file.id}`===target.searchParams.get('file'))?.path
      target.pathname = '/native/pdf'
      target.search = new URLSearchParams({workspaceFileId:file || ''}).toString()
    }
    navigate(target.pathname+target.search+target.hash)
  } else if (target.protocol === 'https:' || target.protocol === 'http:') window.CursadoNative!.openExternal(target.href)
  return null
}
