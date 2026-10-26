import { describe, expect, it } from 'vitest'
import { pdfParts } from '../src/canvas/pdfLayout'
import { previewRequests, IMAGE_CACHE_BYTES } from '../src/canvas/imageCache'

const page = { id: 'page', assetId: 'original', kind: 'pdf-page' as const, pdfSource: true as const, pageNumber: 1, name: 'Original.pdf', x: 100, y: 200, width: 612, height: 792 }
describe('PDF page viewport requests', () => {
  it('keeps separate page identities while sharing the original and requests only visible tiles at high zoom', () => {
    const view = { x: 100, y: 200, width: 250, height: 180 }
    const normal = pdfParts(page, 1, view, 'scope:original')
    expect(normal).toHaveLength(1)
    expect(normal[0].width).toBe(612)
    expect(pdfParts({ ...page, pageNumber: 2 }, 1, view, 'scope:original')[0].id).not.toBe(normal[0].id)
    expect(pdfParts(page, 1, view, 'other-scope')[0].id).not.toBe(normal[0].id)
    const zoomed = pdfParts(page, 8, view, 'scope:original')
    expect(zoomed[0].width).toBeLessThanOrEqual(512)
    expect(zoomed.slice(1).every(tile => tile.width <= 1024 && tile.height <= 1024 && tile.defer)).toBe(true)
    expect(zoomed.length).toBeLessThan(40)
    expect(zoomed.slice(1).every(tile => tile.region.x < 0.7 && tile.region.y < 0.6)).toBe(true)
    const requests = previewRequests(zoomed)
    expect(requests.reduce((sum, r) => sum + r.width * r.height * 4, 0)).toBeLessThanOrEqual(IMAGE_CACHE_BYTES)
  })
  it('reuses stationary page keys after text edits and covers rotated pages', () => {
    const view = { x: 100, y: 200, width: 800, height: 600 }
    const first = pdfParts(page, 4, view, 'original')
    expect(pdfParts({ ...page }, 4, view, 'original')).toEqual(first)
    const rotated = pdfParts({ ...page, rotation: Math.PI / 2 }, 4, view, 'original')
    expect(rotated.length).toBeGreaterThan(1)
    expect(rotated.every(part => part.region.x >= 0 && part.region.y >= 0 && part.region.x + part.region.width <= 1.00001 && part.region.y + part.region.height <= 1.00001)).toBe(true)
  })
})
