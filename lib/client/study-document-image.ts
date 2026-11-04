// Shared by the board and the full-screen reader. Sampling is always bounded.
export function isStudyDocumentImage(image: CanvasImageSource): boolean {
  const sample = document.createElement('canvas'); sample.width = sample.height = 64
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  try {
    ctx.drawImage(image, 0, 0, 64, 64)
    const pixels = ctx.getImageData(0, 0, 64, 64).data
    let visible = 0, white = 0, dark = 0, neutral = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! < 128) continue
      visible++
      const hi = Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!), lo = Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)
      if (hi - lo < 40) neutral++
      if (lo > 205) white++
      if (hi < 140) dark++
    }
    return visible > 0 && neutral / visible > .8 &&
      ((white / visible > .55 && dark / visible > .002) || (visible < 64 * 64 * .75 && dark / visible > .6))
  } catch { return false }
}
