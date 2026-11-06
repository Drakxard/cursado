import { renderSynthesisEditorTiles, type SynthesisSvgProgress } from "./synthesis-svg"
import { createTiledPng } from "./tiled-png"
import { buildRasterSvg, SVG_RENDER_SCALE } from "../../public/pdfjs/web/raster-svg.mjs"
import { yieldExportTask } from "./export-task"
import { katexExportCss } from "./export-katex"

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
  const fastMath = Boolean(katexExportCss())
  async function copy(node: Node, whole = false): Promise<Node | null> {
    checkCancelled(signal)
    if (!whole && !range.intersectsNode(node)) return null
    if (performance.now() - batchStarted >= 12) {
      await yieldExportTask(signal)
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
    if (fastMath && node.matches(".katex-display, .katex")) return node.cloneNode(true)
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

async function renderSelectionTiles(source: HTMLElement, options: ExportOptions,
  writeTile: Parameters<typeof renderSynthesisEditorTiles>[2]) {
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
  try {
    await renderSynthesisEditorTiles(fragment?.source ?? source, { ...options, background }, writeTile)
  } finally { fragment?.remove() }
}

export async function buildSynthesisEditorImage(source: HTMLElement, options: ExportOptions = {}): Promise<Blob> {
  let output: ReturnType<typeof createTiledPng> | undefined
  try {
    await renderSelectionTiles(source, options, async (tile, region) => {
      checkCancelled(options.signal)
      output ??= createTiledPng(tile.width, region.totalHeight * SVG_RENDER_SCALE, options.signal)
      await output.write(tile)
    })
    checkCancelled(options.signal)
    options.onProgress?.({ percent: 99, label: "Preparando imagen PNG…" })
    if (!output) throw new Error("No se pudo generar la imagen PNG.")
    return await output.finish()
  } finally {
    output?.dispose()
  }
}

export async function buildSynthesisEditorExportSvg(source: HTMLElement, options: ExportOptions = {}): Promise<Blob> {
  const pages: Array<{ width: number; height: number; image: string }> = []
  await renderSelectionTiles(source, options, (tile, region) => {
    checkCancelled(options.signal)
    // Lossless PNG per strip: no giant raster surface, JPEG artifacts or global
    // reduction in resolution when imported into an SVG-aware design tool.
    const image = tile.toDataURL("image/png")
    if (!image.startsWith("data:image/png")) throw new Error("No se pudo generar una franja del SVG.")
    pages.push({ width: region.width, height: region.height, image })
  })
  checkCancelled(options.signal)
  return new Blob([buildRasterSvg(pages, 0)], { type: "image/svg+xml;charset=utf-8" })
}

export async function exportSynthesisEditorImage(options: ExportOptions = {}) {
  const source = document.querySelector<HTMLElement>(".simple-editor-wrapper .tiptap")
  if (!source) throw new Error("No se encontró el editor de Síntesis para exportar.")
  const selection = options.selection === undefined ? synthesisExportSelection(source) : options.selection
  const blob = await buildSynthesisEditorExportSvg(source, { ...options, selection })
  checkCancelled(options.signal)
  options.onProgress?.({ percent: 100, label: "Descargando imagen…" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = selection ? "sintesis-seleccion.svg" : "sintesis.svg"
  document.body.append(link)
  try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
