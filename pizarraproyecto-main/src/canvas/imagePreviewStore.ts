import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import { imageDimensions } from './imageDimensions.ts'
import { decodePreview } from './imageCache.ts'
import type { DecodedImage } from './imageCache.ts'
import { previewLevel, PREVIEW_LEVELS } from './imageResolution.ts'
export { previewLevel, PREVIEW_LEVELS } from './imageResolution.ts'

export const PREVIEW_DISK_BYTES = 256 * 1024 * 1024
export type PreviewAsset = { blob: Blob; width: number; height: number; decoded?: DecodedImage }
type PreviewMeta = { key: string; width: number; height: number; bytes: number; used: number }
interface PreviewSchema extends DBSchema {
  metadata: { key: string; value: PreviewMeta; indexes: { used: number } }
  blobs: { key: string; value: Blob }
  state: { key: string; value: number }
}

/** Disposable, local-only data. Metadata cursors never materialize all image blobs. */
export class ImagePreviewStore {
  private database?: Promise<IDBPDatabase<PreviewSchema> | undefined>
  private budget: number
  private name: string
  constructor(budget = PREVIEW_DISK_BYTES, name = 'pizarra-image-previews-v1') { this.budget = budget; this.name = name }
  private db() {
    return this.database ??= openDB<PreviewSchema>(this.name, 2, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore('metadata', { keyPath: 'key' }).createIndex('used', 'used')
          db.createObjectStore('blobs')
        }
        const state = db.createObjectStore('state')
        // One migration scan; regular inserts update a counter atomically instead
        // of scanning every record on every image (quadratic for large boards).
        void (async () => {
          let bytes = 0
          for (let cursor = await transaction.objectStore('metadata').openCursor(); cursor; cursor = await cursor.continue()) bytes += cursor.value.bytes
          await state.put(bytes, 'bytes')
        })().catch(() => transaction.abort())
      },
    }).catch(() => undefined)
  }
  async get(key: string): Promise<PreviewAsset | undefined> {
    try {
      const db = await this.db(); if (!db) return
      const tx = db.transaction(['metadata', 'blobs'], 'readwrite')
      const done = tx.done.catch(() => {})
      const meta = await tx.objectStore('metadata').get(key)
      const blob = meta && await tx.objectStore('blobs').get(key)
      if (meta && blob) await tx.objectStore('metadata').put({ ...meta, used: Date.now() })
      await done
      if (meta && blob) return { blob, width: meta.width, height: meta.height }
    } catch { /* Storage is optional, including private mode and quota errors. */ }
  }
  async put(key: string, asset: PreviewAsset) {
    if (asset.blob.size > this.budget) return
    try {
      const db = await this.db(); if (!db) return
      const tx = db.transaction(['metadata', 'blobs', 'state'], 'readwrite')
      // Consume aborts as well as individual request errors.
      const done = tx.done.catch(() => {})
      try {
        const metadata = tx.objectStore('metadata'), blobs = tx.objectStore('blobs'), state = tx.objectStore('state')
        const previous = await metadata.get(key)
        let total = (await state.get('bytes') ?? 0) - (previous?.bytes ?? 0) + asset.blob.size
        for (let cursor = await metadata.index('used').openCursor(); cursor && total > this.budget; cursor = await cursor.continue()) {
          if (cursor.value.key === key) continue
          total -= cursor.value.bytes
          await blobs.delete(cursor.value.key); await cursor.delete()
        }
        await blobs.put(asset.blob, key)
        await metadata.put({ key, width: asset.width, height: asset.height, bytes: asset.blob.size, used: Date.now() })
        await state.put(total, 'bytes')
      } finally { await done }
    } catch { /* Rendering continues even when previews cannot be persisted. */ }
  }
}

export const imagePreviewStore = new ImagePreviewStore()

/** Called inside the renderer's two-slot queue: generation and decoding share its limit. */
export async function loadImagePreview(key: string, load: () => Promise<Blob | undefined>, width: number, height: number): Promise<PreviewAsset | undefined> {
  const level = previewLevel(Math.max(width, height)), cacheKey = JSON.stringify([key, level])
  const cached = await imagePreviewStore.get(cacheKey)
  if (cached) return cached
  // Build smaller levels from the nearest existing larger derivative. Returning
  // to an overview must not decode every full-size original a second time.
  let larger: PreviewAsset | undefined
  for (const candidate of PREVIEW_LEVELS) {
    if (candidate <= level) continue
    larger = await imagePreviewStore.get(JSON.stringify([key, candidate]))
    if (larger) break
  }
  const original = larger?.blob ?? await load(); if (!original) return
  const size = larger ?? await imageDimensions(original)
  const scale = Math.min(1, level / Math.max(size.width, size.height))
  const target = { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
  // Returning the original encoded bytes here avoids re-encoding small images.
  if (scale === 1) {
    const asset = { blob: original, ...size }; await imagePreviewStore.put(cacheKey, asset); return asset
  }
  const decoded = await decodePreview(original, target.width, target.height)
  const canvas = document.createElement('canvas')
  let transferred = false
  try {
    canvas.width = target.width; canvas.height = target.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('No se pudo preparar la vista previa.')
    ctx.drawImage(decoded.source, 0, 0)
    // PNG preserves text and alpha without adding lossy compression artifacts.
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('No se pudo guardar la vista previa.')), 'image/png'))
    const asset: PreviewAsset = { blob, ...target }; await imagePreviewStore.put(cacheKey, asset)
    const displayScale = Math.min(1, width / target.width, height / target.height)
    const displayWidth = Math.max(1, Math.floor(target.width * displayScale)), displayHeight = Math.max(1, Math.floor(target.height * displayScale))
    if (displayWidth === target.width && displayHeight === target.height) {
      asset.decoded = decoded; transferred = true
    } else if (typeof createImageBitmap === 'function') {
      // Resize the pixels already decoded for generation instead of decoding the
      // newly encoded file again. This also avoids another PNG decoder buffer.
      const display = document.createElement('canvas')
      try {
        display.width = displayWidth; display.height = displayHeight
        const context = display.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('No se pudo preparar la vista previa.')
        context.drawImage(canvas, 0, 0, displayWidth, displayHeight)
        // Snapshot an independent, small CPU surface: resizing a bitmap directly
        // can keep its larger backing surface alive in the graphics backend.
        const bitmap = await createImageBitmap(display, { resizeWidth: displayWidth, resizeHeight: displayHeight })
        asset.decoded = { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
      } catch { /* The renderer can still decode the encoded derivative. */ }
      finally { display.width = display.height = 0 }
    }
    return asset
  } finally { if (!transferred) decoded.release(); canvas.width = canvas.height = 0 }
}
