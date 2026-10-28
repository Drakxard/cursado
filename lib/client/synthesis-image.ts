import { renderSynthesisEditorTiles, type SynthesisSvgProgress } from "./synthesis-svg"

export type SynthesisImageProgress = SynthesisSvgProgress
type ExportOptions = {
  onProgress?: (progress: SynthesisImageProgress) => void
  signal?: AbortSignal
  selection?: Range | null
}
const CONTROLS = ".synthesis-image-size-controls, .column-resize-handle, .ProseMirror-gapcursor, .ProseMirror-widget, .ProseMirror-separator"
const ATOMS = "[data-synthesis-math], .katex-display, .katex, math, img"

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Exportación cancelada.", "AbortError")
}

export function synthesisExportSelection(source: HTMLElement): Range | null {
  const selection = source.ownerDocument.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) {
    const selected = source.querySelector(".ProseMirror-selectednode, .synthesis-local-image.is-selected")
    if (!selected) return null
    const range = source.ownerDocument.createRange()
    range.selectNode(selected)
    return range
  }
  const range = selection.getRangeAt(0)
  return source.contains(range.startContainer) && source.contains(range.endContainer) ? range.cloneRange() : null
}

// Keep selected text and its structural ancestors. Formula nodes are indivisible:
// copying a fraction's visual subtree alone would lose its mathematical layout.
async function selectedContent(source: HTMLElement, range: Range, signal?: AbortSignal) {
  let batchStarted = performance.now()
  async function copy(node: Node, whole = false): Promise<Node | null> {
    checkCancelled(signal)
    if (!whole && !range.intersectsNode(node)) return null
    if (performance.now() - batchStarted >= 12) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 16))
      checkCancelled(signal)
      batchStarted = performance.now()
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      const start = !whole && range.startContainer === node ? range.startOffset : 0
      const end = !whole && range.endContainer === node ? range.endOffset : text.length
      return end > start ? document.createTextNode(text.slice(start, end)) : null
    }
    if (!(node instanceof Element) || node.matches(CONTROLS)) return null
    const clone = node.cloneNode(false) as HTMLElement
    const style = getComputedStyle(node)
    if (clone.style) {
      for (const property of Array.from(style)) clone.style.setProperty(property, style.getPropertyValue(property))
      clone.style.setProperty("animation", "none")
      clone.style.setProperty("transition", "none")
      // Resolved block heights include unselected lines. Let the fragment reflow.
      if (/^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|TABLE|TBODY|THEAD|TFOOT|TR|TD|TH)$/.test(node.tagName) && !node.matches(ATOMS)) {
        clone.style.height = "auto"
        clone.style.minHeight = "0"
        clone.style.maxHeight = "none"
      }
    }
    const atomic = whole || node.matches(ATOMS)
    for (const child of Array.from(node.childNodes)) {
      const result = await copy(child, atomic)
      if (result) clone.append(result)
    }
    if (node instanceof HTMLOListElement) {
      const first = Array.from(node.children).findIndex(child => range.intersectsNode(child))
      if (first >= 0) (clone as HTMLOListElement).start = node.start + first
    }
    return clone
  }
  const clone = await copy(source) as HTMLElement | null
  if (!clone) throw new Error("No se pudo preparar la selección de Síntesis.")
  Object.assign(clone.style, { boxSizing: "border-box", width: `${source.offsetWidth}px`, maxWidth: "none", minWidth: "0", height: "auto", minHeight: "0", maxHeight: "none", margin: "0", position: "relative", top: "auto", left: "auto", transform: "none", overflow: "visible" })
  clone.removeAttribute("contenteditable")
  const host = document.createElement("div")
  host.className = source.parentElement?.className ?? ""
  host.setAttribute("aria-hidden", "true")
  host.inert = true
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", opacity: "0", pointerEvents: "none", width: `${source.offsetWidth}px` })
  host.append(clone)
  document.body.append(host)
  return { source: clone, remove: () => host.remove() }
}

export async function buildSynthesisEditorImage(source: HTMLElement, options: ExportOptions = {}): Promise<Blob> {
  // Snapshot before any yield or progress dialog can move browser focus.
  const range = options.selection === undefined ? synthesisExportSelection(source) : options.selection?.cloneRange()
  checkCancelled(options.signal)
  await document.fonts.ready
  let background = "#ffffff"
  for (let element: HTMLElement | null = source; element; element = element.parentElement) {
    const color = getComputedStyle(element).backgroundColor
    if (color !== "transparent" && !/^rgba\([^)]*,\s*0\)$/.test(color)) { background = color; break }
  }
  const fragment = range ? await selectedContent(source, range, options.signal) : null
  const output = document.createElement("canvas")
  let scale = 1, initialized = false
  try {
    await renderSynthesisEditorTiles(fragment?.source ?? source, { ...options, background }, (tile, region) => {
      checkCancelled(options.signal)
      if (!initialized) {
        // One PNG, with a bounded surface even for a very long complete document.
        scale = Math.min(2, 16384 / region.width, 16384 / region.totalHeight, Math.sqrt(16 * 1024 * 1024 / (region.width * region.totalHeight)))
        output.width = Math.max(1, Math.ceil(region.width * scale))
        output.height = Math.max(1, Math.ceil(region.totalHeight * scale))
        initialized = true
      }
      const context = output.getContext("2d", { alpha: false })
      if (!context) throw new Error("El navegador no pudo crear la imagen de exportación.")
      const top = Math.round(region.y * scale), bottom = region.y + region.height === region.totalHeight ? output.height : Math.round((region.y + region.height) * scale)
      context.drawImage(tile, 0, top, output.width, bottom - top)
    })
    checkCancelled(options.signal)
    options.onProgress?.({ percent: 99, label: "Preparando imagen PNG…" })
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(result => result ? resolve(result) : reject(new Error("No se pudo generar la imagen PNG.")), "image/png"))
    checkCancelled(options.signal)
    return blob
  } finally {
    fragment?.remove()
    output.width = 1
    output.height = 1
  }
}

export async function exportSynthesisEditorImage(options: ExportOptions = {}) {
  const source = document.querySelector<HTMLElement>(".simple-editor-wrapper .tiptap")
  if (!source) throw new Error("No se encontró el editor de Síntesis para exportar.")
  const selection = options.selection === undefined ? synthesisExportSelection(source) : options.selection
  const blob = await buildSynthesisEditorImage(source, { ...options, selection })
  checkCancelled(options.signal)
  options.onProgress?.({ percent: 100, label: "Descargando imagen…" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = selection ? "sintesis-seleccion.png" : "sintesis.png"
  document.body.append(link)
  try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
