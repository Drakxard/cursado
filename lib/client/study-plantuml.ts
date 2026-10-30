/** Render mindmaps locally with the board's PlantUML + KaTeX renderer. */
export function renderStudyMindmap(source: string, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.src = '/pizarra/plantuml.html'
    frame.title = 'Renderizador de PlantUML'
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    Object.assign(frame.style, { position: 'fixed', left: '-100000px', width: '1024px', height: '768px', border: '0' })
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      signal.removeEventListener('abort', abort)
      frame.remove()
    }
    const abort = () => { cleanup(); reject(new DOMException('Render cancelado', 'AbortError')) }
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return
      if (event.data?.type === 'plantuml:ready') frame.contentWindow?.postMessage({ type: 'plantuml:render', source }, location.origin)
      if (event.data?.type === 'plantuml:result') {
        cleanup()
        if (event.data.blob instanceof Blob && event.data.blob.type === 'image/png') resolve(event.data.blob)
        else reject(new Error(event.data.error || 'No se pudo generar el mapa.'))
      }
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error('No se pudo cargar o renderizar PlantUML. Intentá nuevamente.')) }, 90_000)
    window.addEventListener('message', receive)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    document.body.append(frame)
  })
}
