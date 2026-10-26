import { previewLevel } from './imageResolution.ts'

export type ImageRequest = { id: string; width: number; height: number }
export type DecodedImage = { source: CanvasImageSource; width: number; height: number; release: () => void }
export const IMAGE_CACHE_BYTES = 64 * 1024 * 1024
export type PreviewInput = Blob | { blob: Blob; width: number; height: number; decoded?: DecodedImage }

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
export function previewRequests(items: ImageRequest[], budget = IMAGE_CACHE_BYTES, levels?: ReadonlyMap<string, number>): ImageRequest[] {
  const wanted = new Map<string, ImageRequest>()
  for (const item of items) {
    const side = Math.max(1, item.width, item.height)
    const level = levels?.get(item.id) ?? previewLevel(side)
    // Encoded derivatives use power-of-two levels. Retained pixels only need the
    // screen size (rounded to 64px), avoiding a 2x allocation at a level boundary.
    const displaySide = Math.min(level, Math.ceil(side / 64) * 64)
    const width = Math.max(1, Math.floor(item.width * displaySide / side))
    const height = Math.max(1, Math.floor(item.height * displaySide / side))
    const previous = wanted.get(item.id)
    wanted.set(item.id, { id: item.id, width: Math.max(width, previous?.width ?? 1), height: Math.max(height, previous?.height ?? 1) })
  }
  const pixels = [...wanted.values()].reduce((sum, item) => sum + item.width * item.height, 0)
  const scale = Math.min(1, Math.sqrt(budget / 4 / Math.max(1, pixels)))
  return [...wanted.values()].map(item => ({ id: item.id, width: Math.max(1, Math.floor(item.width * scale)), height: Math.max(1, Math.floor(item.height * scale)) }))
}

export class AdaptiveImageCache {
  private entries = new Map<string, DecodedImage>()
  private signatures = new Map<string, string>()
  private wanted = new Map<string, ImageRequest>()
  private running = new Set<string>()
  private failures = new Map<string, string>()
  private generation = 0
  private stopped = false
  private load: (id: string, request: ImageRequest) => Promise<PreviewInput | undefined>
  private changed: () => void
  private decode: typeof decodePreview
  readonly budget: number
  private resizeTimer?: ReturnType<typeof setTimeout>
  private cameraKey?: string
  private levels = new Map<string, number>()
  constructor(load: (id: string, request: ImageRequest) => Promise<PreviewInput | undefined>, changed: () => void,
    decode = decodePreview, budget = IMAGE_CACHE_BYTES) {
    this.load = load; this.changed = changed; this.decode = decode; this.budget = budget
  }
  get(id: string) { return this.entries.get(id)?.source }
  get bytes() { return [...this.entries.values()].reduce((sum, image) => sum + image.width * image.height * 4, 0) }
  get size() { return this.entries.size }
  get pending() { return this.running.size }
  retry() { this.failures.clear() }
  reconcile(items: ImageRequest[], cameraKey?: string) {
    this.stopped = false
    const sides = new Map<string, number>()
    for (const item of items) sides.set(item.id, Math.max(sides.get(item.id) ?? 1, item.width, item.height))
    for (const [id, side] of sides) this.levels.set(id, previewLevel(side, this.levels.get(id)))
    for (const id of this.levels.keys()) if (!sides.has(id)) this.levels.delete(id)
    const next = new Map(previewRequests(items, this.budget, this.levels).map(item => [item.id, item]))
    const resized = [...next].some(([id, item]) => {
      const previous = this.wanted.get(id)
      return previous && this.signature(previous) !== this.signature(item)
    })
    this.wanted = next
    const moved = cameraKey !== undefined && this.cameraKey !== undefined && cameraKey !== this.cameraKey
    this.cameraKey = cameraKey
    if (resized || moved) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => { this.resizeTimer = undefined; this.pump() }, 150)
    }
    for (const [id, image] of this.entries) {
      const request = this.wanted.get(id)
      if (!request) { image.release(); this.entries.delete(id); this.signatures.delete(id) }
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
      const existing = this.entries.get(id)
      if (this.signatures.get(id) === signature || (existing && this.resizeTimer !== undefined) || this.running.has(id) || this.failures.get(id) === signature) continue
      const generation = this.generation
      this.running.add(id)
      void (async () => {
        let image: DecodedImage | undefined
        try {
          const input = await this.load(id, request)
          const wanted = this.wanted.get(id)
          if (generation !== this.generation || !wanted) {
            if (input && !(input instanceof Blob)) input.decoded?.release()
            return
          }
          if (!input) throw new Error('Recurso no disponible')
          const blob = input instanceof Blob ? input : input.blob
          // Never enlarge small originals or distort their aspect ratio.
          const scale = input instanceof Blob ? 1 : Math.min(1, request.width / input.width, request.height / input.height)
          const width = input instanceof Blob ? request.width : Math.max(1, Math.floor(input.width * scale))
          const height = input instanceof Blob ? request.height : Math.max(1, Math.floor(input.height * scale))
          image = input instanceof Blob || !input.decoded ? await this.decode(blob, width, height) : input.decoded
          const current = this.wanted.get(id)
          if (generation !== this.generation || !current) { image.release(); return }
          // An intermediate result can still fill a blank while the camera moves.
          if (this.signature(current) !== signature && this.entries.has(id)) { image.release(); return }
          const previous = this.entries.get(id)
          const nextBytes = () => this.bytes - (previous ? previous.width * previous.height * 4 : 0) + image!.width * image!.height * 4
          // Old resolutions must not double the retained budget during replacement.
          for (const [otherId, other] of this.entries) {
            if (nextBytes() <= this.budget) break
            const target = this.wanted.get(otherId)
            if (otherId !== id && target && this.signatures.get(otherId) !== this.signature(target)) {
              other.release(); this.entries.delete(otherId); this.signatures.delete(otherId)
            }
          }
          if (nextBytes() > this.budget) { image.release(); return }
          this.entries.set(id, image)
          this.signatures.set(id, signature)
          previous?.release()
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
    clearTimeout(this.resizeTimer); this.resizeTimer = undefined
    this.cameraKey = undefined
    this.stopped = true
    this.wanted.clear(); this.failures.clear()
    for (const image of this.entries.values()) image.release()
    this.entries.clear(); this.signatures.clear(); this.levels.clear()
  }
}
