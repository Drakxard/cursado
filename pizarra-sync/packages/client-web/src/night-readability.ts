/** Viewer-only night palette. Never writes transformed colours into the shared document. */
export function installNightReadability() {
  const root = document.documentElement
  const originals = new WeakMap<Element, Map<string, { original: string; applied: string }>>()
  const analyzed = new WeakMap<HTMLImageElement, string>()
  const queue = new Set<Element>()
  let scheduled = false
  const dark = () => root.dataset.theme === 'dark'
  const context = document.createElement('canvas').getContext('2d')!
  const color = (raw: string): string => {
    if (!raw || raw === 'none' || raw === 'transparent' || raw === 'inherit' || raw === 'currentColor' || raw.includes('var(') || raw.includes('url(')) return raw
    context.fillStyle = '#010203'; context.fillStyle = raw
    const normalized = context.fillStyle
    let channels: number[]
    if (/^#[\da-f]{6}$/i.test(normalized)) channels = [1, 3, 5].map(at => parseInt(normalized.slice(at, at + 2), 16))
    else if (/^rgba?\(/.test(normalized)) channels = normalized.match(/[\d.]+/g)!.map(Number)
    else return raw
    const r = channels[0]! / 255, g = channels[1]! / 255, b = channels[2]! / 255
    const high = Math.max(r, g, b), low = Math.min(r, g, b), light = (high + low) / 2
    // Reflect lightness, retaining hue and saturation. Avoid pure white glare.
    const target = 0.08 + (1 - light) * 0.82
    const span = high - low
    const saturation = span === 0 ? 0 : span / (1 - Math.abs(2 * light - 1))
    const nextSpan = (1 - Math.abs(2 * target - 1)) * saturation
    const base = target - nextSpan / 2
    const mapped = [r, g, b].map(v => Math.round(255 * (span ? base + (v - low) / span * nextSpan : target)))
    return `rgba(${mapped.join(',')},${channels[3] ?? 1})`
  }
  const transform = (el: Element, key: string, read: () => string, write: (value: string) => void) => {
    let saved = originals.get(el)
    if (!saved) { saved = new Map(); originals.set(el, saved) }
    const raw = read(), previous = saved.get(key)
    const original = previous && raw === previous.applied ? previous.original : raw
    const applied = dark() && !el.closest('.komu-text-editor') ? color(original) : original
    if (raw !== applied) write(applied)
    saved.set(key, { original, applied: read() })
  }
  const analyze = (img: HTMLImageElement) => {
    if (!img.complete || !img.naturalWidth || analyzed.get(img) === img.currentSrc) return
    analyzed.set(img, img.currentSrc)
    img.removeAttribute('data-night-diagram')
    // A tiny thumbnail bounds CPU/memory regardless of source resolution.
    const sample = document.createElement('canvas'); sample.width = sample.height = 48
    const ctx = sample.getContext('2d', { willReadFrequently: true })!
    try {
      ctx.drawImage(img, 0, 0, 48, 48)
      const pixels = ctx.getImageData(0, 0, 48, 48).data
      let visible = 0, white = 0, black = 0, neutral = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! < 128) continue
        visible++
        const hi = Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!), lo = Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)
        if (hi - lo < 35) neutral++
        if (lo > 205) white++
        if (hi < 110) black++
      }
      const lightDocument = white / visible > .6 && black / visible > .005
      const transparentInk = visible < 48 * 48 * .75 && black / visible > .6
      if (visible && neutral / visible > .85 && (lightDocument || transparentInk)) img.dataset.nightDiagram = 'true'
    } catch { /* CORS-protected images retain their original colours. */ }
  }
  const paint = (el: Element) => {
    if (el instanceof HTMLImageElement && el.closest('.komu-image')) { if (dark()) analyze(el); return }
    if (!el.closest('.komu-text:not([data-study]), .komu-ink') || el.closest('button, video, iframe, .study-video-body')) return
    if (el instanceof HTMLElement || el instanceof SVGElement) {
      for (const prop of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'fill', 'stroke']) {
        if (el.style.getPropertyValue(prop) || originals.get(el)?.has(prop)) transform(el, prop, () => el.style.getPropertyValue(prop), value => el.style.setProperty(prop, value))
      }
    }
    for (const attr of ['fill', 'stroke']) if (el.hasAttribute(attr)) transform(el, `attr:${attr}`, () => el.getAttribute(attr)!, value => el.setAttribute(attr, value))
  }
  const scan = (node: Element) => { paint(node); node.querySelectorAll('.komu-text, .komu-text *, .komu-ink, .komu-ink *, .komu-image img').forEach(paint) }
  const flush = () => { scheduled = false; for (const el of queue) if (el.isConnected) scan(el); queue.clear() }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target as Element
        // Camera transforms, grid variables and cursor chrome never change object colours.
        // Scanning their descendants here defeats the compositor-only zoom path.
        if (!target.matches('.komu-image img') && !target.closest('.komu-text, .komu-ink')) continue
        queue.add(target)
      }
      else for (const node of record.addedNodes) if (node instanceof Element) queue.add(node)
    }
    if (queue.size && !scheduled) { scheduled = true; requestAnimationFrame(flush) }
  })
  observer.observe(document.getElementById('board')!, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'fill', 'stroke', 'src', 'class'] })
  new MutationObserver(() => scan(document.getElementById('board')!)).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  document.addEventListener('load', event => { if (event.target instanceof HTMLImageElement && event.target.closest('.komu-image') && dark()) analyze(event.target) }, true)
  try { root.dataset.nightImages = localStorage.getItem('study-night-images') || 'auto' } catch { root.dataset.nightImages = 'auto' }
  scan(document.getElementById('board')!)
}
