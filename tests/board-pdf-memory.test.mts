import assert from 'node:assert/strict'
import test from 'node:test'
import { BoardPageViewBuffer, BOARD_PDF_CACHE_BYTES } from '../public/pdfjs/web/board-memory.mjs'

function page(id: number, mib: number) {
  const canvases = [{ width: 1024, height: mib * 256 }]
  return { id, canvases, destroyed: false,
    div: { querySelectorAll: () => canvases },
    destroy() { this.destroyed = true; canvases.forEach(canvas => { canvas.width = canvas.height = 0 }) },
  }
}

test('PDF cache evicts least recently visited pages by count and actual canvas bytes', () => {
  const cache = new BoardPageViewBuffer()
  const pages = [1,2,3,4].map(id => page(id, 12))
  for (const item of pages) { cache.resize(3, new Set([item.id])); cache.push(item); cache.trim() }
  assert.equal(pages[0].destroyed, true)
  assert.deepEqual([...cache].map(item => item.id), [2,3,4])
  cache.push(pages[1]) // revisit page 2
  cache.resize(3, new Set([5]))
  const large = page(5, 45)
  cache.push(large); cache.trim()
  assert.ok(cache.bytes <= BOARD_PDF_CACHE_BYTES)
  assert.deepEqual([...cache].map(item => item.id), [2,5])
})

test('visible pages keep full quality even when they exceed count and byte budgets', () => {
  const cache = new BoardPageViewBuffer()
  const visible = [1,2,3,4].map(id => page(id, 24))
  cache.resize(3, new Set(visible.map(item => item.id)))
  visible.forEach(item => cache.push(item)); cache.trim()
  assert.equal(cache.bytes, 96 * 1024 * 1024)
  assert.ok(visible.every(item => !item.destroyed))
  cache.resize(3, new Set([4]))
  assert.ok(cache.bytes <= BOARD_PDF_CACHE_BYTES)
  assert.equal(visible[3].destroyed, false)
})

test('post-render accounting includes detail canvases; hiding retains only the last visible view', () => {
  const cache = new BoardPageViewBuffer()
  const first = page(1, 24), second = page(2, 24)
  cache.resize(3, new Set([1])); cache.push(first)
  cache.resize(3, new Set([2])); cache.push(second)
  second.canvases.push({width:1024,height:30*256})
  cache.trim()
  assert.equal(first.destroyed, true)
  const third=page(3, 4)
  cache.resize(3,new Set([3]));cache.push(third)
  cache.resize(0,new Set([3]))
  assert.deepEqual([...cache].map(item => item.id),[3])
  assert.equal(cache.bytes,4*1024*1024)
  cache.resize(0,new Set())
  assert.equal(cache.bytes,0)
})
