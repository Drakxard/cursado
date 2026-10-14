type SaveBeforeHome = () => Promise<void> | void
const saves = new Set<SaveBeforeHome>()
const writes = new Set<Promise<Response>>()
let leaving = false
let writeError: Error | null = null

export function trackHomeWrites(current: Window) {
  const original = current.fetch
  const tracked: typeof fetch = (input, init) => {
    const request = typeof input === 'object' && 'url' in input && 'method' in input ? input as Request : null
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const url = new URL(request?.url ?? String(input), current.location.href)
    const task = original.call(current, input, init)
    // Optional cloud backups don't determine whether the local draft is saved.
    const backgroundBackup = url.pathname.startsWith('/api/storage/') || url.pathname.startsWith('/api/google/drive/') || url.pathname === '/api/inscreen/widget-targets'
    if (url.origin === current.location.origin && url.pathname.startsWith('/api/') && !backgroundBackup && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const checked = task.then(response => {
        if (!response.ok) throw new Error('No se pudieron guardar todos los cambios. Reintentá el guardado antes de salir.')
        return response
      }).catch(error => {
        if (leaving) writeError = error instanceof Error ? error : new Error('No se pudieron guardar los cambios.')
        throw error
      })
      writes.add(checked)
      void checked.then(() => writes.delete(checked), () => writes.delete(checked))
    }
    return task
  }
  current.fetch = tracked
  return () => { if (current.fetch === tracked) current.fetch = original }
}

async function waitForWrites() {
  while (writes.size) await Promise.all([...writes])
  if (writeError) throw writeError
}

async function saveEmbeddedDocuments(current: Window) {
  let frames: HTMLIFrameElement[]
  try { frames = [...current.document.querySelectorAll('iframe')] } catch { return }
  for (const frame of frames) {
    if (!frame.contentWindow) continue
    const child = frame.contentWindow as Window & { __cursadoBeforeHome?: SaveBeforeHome }
    let save: SaveBeforeHome | undefined
    try {
      const focused = child.document.activeElement as HTMLElement | null
      if (typeof focused?.blur === 'function') focused.blur()
      save = child.__cursadoBeforeHome
    } catch { continue }
    await saveEmbeddedDocuments(child)
    await save?.()
  }
}

export function registerHomeSave(save: SaveBeforeHome) {
  saves.add(save)
  return () => { saves.delete(save) }
}

export async function returnToHome() {
  if (leaving || window.location.pathname === '/') return
  leaving = true
  writeError = null
  try {
    // Commit focused controls before reading their current state.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    await waitForWrites()
    await saveEmbeddedDocuments(window)
    for (const save of [...saves]) await save()
    await waitForWrites()
    window.location.assign('/')
  } catch (error) {
    window.dispatchEvent(new CustomEvent('cursado-home-error', { detail: error instanceof Error ? error.message : 'No se pudieron guardar los cambios.' }))
  } finally { leaving = false }
}
