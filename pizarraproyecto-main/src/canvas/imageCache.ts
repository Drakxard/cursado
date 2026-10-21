export type ImageRequest = { id: string; width: number; height: number }
export type DecodedImage = { source: CanvasImageSource; width: number; height: number; release: () => void }
export const IMAGE_CACHE_BYTES = 64 * 1024 * 1024

/** Resize during decoding where supported; never retain the original pixels. */
export async function decodePreview(blob: Blob, width: number, height: number): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* SVG and older decoders may require the image-element fallback. */ }
  }
  const url = URL.createObjectURL(blob), image = new Image(), canvas = document.createElement('canvas')
  try {
    image.src = url
    await image.decode()
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo preparar la imagen.')
    context.drawImage(image, 0, 0, width, height)
    return { source: canvas, width, height, release: () => { canvas.width = canvas.height = 0 } }
  } finally { image.src = ''; URL.revokeObjectURL(url) }
}

/** Allocate the budget across visible assets, including a single oversized asset. */
export function previewRequests(items: ImageRequest[], budget = IMAGE_CACHE_BYTES): ImageRequest[] {
  const wanted = new Map<string, ImageRequest>()
  for (const item of items) {
    const width = Math.max(1, Math.min(4096, Math.ceil(item.width / 64) * 64))
    const height = Math.max(1, Math.min(4096, Math.ceil(item.height / 64) * 64))
    const previous = wanted.get(item.id)
    wanted.set(item.id, { id: item.id, width: Math.max(width, previous?.width ?? 1), height: Math.max(height, previous?.height ?? 1) })
  }
  const pixels = [...wanted.values()].reduce((sum, item) => sum + item.width * item.height, 0)
  const scale = Math.min(1, Math.sqrt(budget / 4 / Math.max(1, pixels)))
  return [...wanted.values()].map(item => ({ id: item.id, width: Math.max(1, Math.floor(item.width * scale)), height: Math.max(1, Math.floor(item.height * scale)) }))
}

export class AdaptiveImageCache {
  private entries = new Map<string, DecodedImage>()
  private wanted = new Map<string, ImageRequest>()
  private running = new Set<string>()
  private failures = new Map<string, string>()
  private generation = 0
  private stopped = false
  private load: (id: string) => Promise<Blob | undefined>
  private changed: () => void
  private decode: typeof decodePreview
  readonly budget: number
  constructor(load: (id: string) => Promise<Blob | undefined>, changed: () => void,
    decode = decodePreview, budget = IMAGE_CACHE_BYTES) {
    this.load = load; this.changed = changed; this.decode = decode; this.budget = budget
  }
  get(id: string) { return this.entries.get(id)?.source }
  get bytes() { return [...this.entries.values()].reduce((sum, image) => sum + image.width * image.height * 4, 0) }
  get size() { return this.entries.size }
  get pending() { return this.running.size }
  retry() { this.failures.clear() }
  reconcile(items: ImageRequest[]) {
    this.stopped = false
    this.wanted = new Map(previewRequests(items, this.budget).map(item => [item.id, item]))
    for (const [id, image] of this.entries) {
      const request = this.wanted.get(id)
      if (!request || image.width !== request.width || image.height !== request.height) { image.release(); this.entries.delete(id) }
    }
    for (const id of this.failures.keys()) if (!this.wanted.has(id)) this.failures.delete(id)
    this.pump()
  }
  private signature(item: ImageRequest) { return `${item.width}:${item.height}` }
  private pump() {
    if (this.stopped) return
    for (const [id, request] of this.wanted) {
      if (this.running.size >= 2) break
      const signature = this.signature(request)
      if (this.entries.has(id) || this.running.has(id) || this.failures.get(id) === signature) continue
      const generation = this.generation
      this.running.add(id)
      void (async () => {
        let image: DecodedImage | undefined
        try {
          const blob = await this.load(id)
          const wanted = this.wanted.get(id)
          if (generation !== this.generation || !wanted || this.signature(wanted) !== signature) return
          if (!blob) throw new Error('Recurso no disponible')
          image = await this.decode(blob, request.width, request.height)
          const current = this.wanted.get(id)
          if (generation !== this.generation || !current || this.signature(current) !== signature) { image.release(); return }
          if (this.bytes + image.width * image.height * 4 > this.budget) { image.release(); this.failures.set(id, signature); return }
          this.entries.set(id, image)
        } catch {
          if (generation === this.generation) this.failures.set(id, signature)
        } finally {
          this.running.delete(id)
          if (!this.stopped) { this.changed(); this.pump() }
        }
      })()
    }
  }
  clear() {
    this.generation++
    this.stopped = true
    this.wanted.clear(); this.failures.clear()
    for (const image of this.entries.values()) image.release()
    this.entries.clear()
  }
}
