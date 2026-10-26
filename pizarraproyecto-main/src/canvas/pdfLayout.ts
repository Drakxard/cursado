import type { MediaItem } from '../storage/database'
import type { ImageRequest } from './imageCache'

export type PdfRegion = { x: number; y: number; width: number; height: number }
export type PdfPart = ImageRequest & { assetId: string; pageNumber: number; scope: string; region: PdfRegion }
type Page = MediaItem & { rotation?: number }
type Rect = { x: number; y: number; width: number; height: number }
export const PDF_TILE_SIDE = 1024
export const PDF_TILE_THRESHOLD = 2048
const full = { x: 0, y: 0, width: 1, height: 1 }

/** Visible world bounds projected back into the unrotated page, in fractions. */
function localView(item: Page, view: Rect): PdfRegion {
  const cx = item.x + item.width / 2, cy = item.y + item.height / 2
  const cos = Math.cos(item.rotation ?? 0), sin = Math.sin(item.rotation ?? 0)
  const corners = [[view.x, view.y], [view.x + view.width, view.y], [view.x, view.y + view.height], [view.x + view.width, view.y + view.height]]
    .map(([x, y]) => ({ x: ((x - cx) * cos + (y - cy) * sin + item.width / 2) / item.width,
      y: (-(x - cx) * sin + (y - cy) * cos + item.height / 2) / item.height }))
  const x = Math.max(0, Math.min(...corners.map(p => p.x))), y = Math.max(0, Math.min(...corners.map(p => p.y)))
  return { x, y, width: Math.max(0, Math.min(1, Math.max(...corners.map(p => p.x))) - x), height: Math.max(0, Math.min(1, Math.max(...corners.map(p => p.y))) - y) }
}

/** Stable page/region IDs prevent duplicate pages and camera-dependent reloads. */
export function pdfParts(item: Page, pixels: number, view: Rect, scope: string): PdfPart[] {
  const side = Math.max(item.width, item.height) * pixels
  const tiled = side > PDF_TILE_THRESHOLD
  const previewSide = tiled ? 512 : Math.max(1, side)
  const make = (suffix: string, width: number, height: number, region: PdfRegion, defer = false): PdfPart => ({
    id: `pdf:${JSON.stringify([scope, item.pageNumber, suffix])}`, assetId: item.assetId, scope, pageNumber: item.pageNumber!, width, height, region, defer,
  })
  const parts = [make('preview', previewSide * item.width / Math.max(item.width, item.height), previewSide * item.height / Math.max(item.width, item.height), full)]
  if (!tiled) return parts
  const level = 2 ** Math.ceil(Math.log2(side))
  const width = level * item.width / Math.max(item.width, item.height), height = level * item.height / Math.max(item.width, item.height)
  const visible = localView(item, view)
  if (!visible.width || !visible.height) return parts
  const left = Math.max(0, Math.floor((visible.x * width - 128) / PDF_TILE_SIDE))
  const top = Math.max(0, Math.floor((visible.y * height - 128) / PDF_TILE_SIDE))
  const right = Math.min(Math.ceil(width / PDF_TILE_SIDE), Math.ceil(((visible.x + visible.width) * width + 128) / PDF_TILE_SIDE))
  const bottom = Math.min(Math.ceil(height / PDF_TILE_SIDE), Math.ceil(((visible.y + visible.height) * height + 128) / PDF_TILE_SIDE))
  for (let row = top; row < bottom; row++) for (let col = left; col < right; col++) {
    const x = col * PDF_TILE_SIDE, y = row * PDF_TILE_SIDE
    const w = Math.min(PDF_TILE_SIDE, width - x), h = Math.min(PDF_TILE_SIDE, height - y)
    parts.push(make(`${level}:${col}:${row}`, w, h, { x: x / width, y: y / height, width: w / width, height: h / height }, true))
  }
  return parts
}
