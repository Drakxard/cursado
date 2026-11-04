import { svgToPng } from '../study-svg-import'

export function mermaidMindmapSource(source: string, rootOnly = false): string {
  const text = source.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim()
  if (!text || text.length > 100000) throw new Error('Pegá un mapa Mermaid de hasta 100.000 caracteres.')
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex(line => /^\s*mindmap\s*$/.test(line))
  if (header < 0) throw new Error('El diagrama debe empezar con mindmap, después de su configuración opcional.')
  const root = lines.findIndex((line, index) => index > header && !!line.trim() && !line.trimStart().startsWith('%%'))
  if (root < 0) throw new Error('Agregá la raíz del mapa debajo de mindmap.')
  if (rootOnly) return lines.slice(0, root + 1).join('\n')
  return lines.map((line, index) => {
    if (index <= root) return line
    const label = line.trim()
    // Mermaid treats COUNT(*) and "Virtuales (estándar)" as node IDs + shapes,
    // silently discarding the prefix. Quote these plain SQL/parenthetical labels.
    if (!/\s\([^)]*\)$/.test(label) && !/^(?:COUNT|SUM|AVG|MIN|MAX)\([^)]*\)$/i.test(label)) return line
    const quoted = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    return `${line.match(/^\s*/)?.[0]}__study_label_${index}["${quoted}"]`
  }).join('\n')
}

let queue: Promise<unknown> = Promise.resolve()
let renderId = 0

/** Mermaid shares configuration, so full/root renders must not overlap. */
export function renderStudyMermaid(source: string, signal: AbortSignal, rootOnly = false): Promise<Blob> {
  const text = mermaidMindmapSource(source, rootOnly)
  const render = async () => {
    signal.throwIfAborted()
    const { default: mermaid } = await import('mermaid')
    signal.throwIfAborted()
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: 100000,
      secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'htmlLabels', 'suppressErrorRendering'],
      mindmap: { useMaxWidth: false },
    })
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: '1200px', visibility: 'hidden' })
    document.body.append(host)
    try {
      await document.fonts.ready
      const { svg } = await mermaid.render(`study-mindmap-${++renderId}`, text, host)
      signal.throwIfAborted()
      const blob = await svgToPng(new File([svg], 'mindmap.svg', { type: 'image/svg+xml' }))
      signal.throwIfAborted()
      return blob
    } finally { host.remove() }
  }
  const result = queue.then(render, render)
  queue = result.catch(() => undefined)
  return result
}
