import assert from 'node:assert/strict'
import test from 'node:test'
import { AdaptiveImageCache, previewRequests, IMAGE_CACHE_BYTES } from '../pizarraproyecto-main/src/canvas/imageCache.ts'

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)) }

test('visible previews share a hard 64 MiB budget, even when one asset is oversized', () => {
  for (const count of [1, 12, 300]) {
    const requests = previewRequests(Array.from({ length: count }, (_, i) => ({ id: String(i), width: 30000, height: 20000 })))
    assert.ok(requests.reduce((sum, item) => sum + item.width * item.height * 4, 0) <= IMAGE_CACHE_BYTES)
  }
  assert.equal(previewRequests([{ id: 'same', width: 200, height: 100 }, { id: 'same', width: 400, height: 300 }]).length, 1)
})

test('at most two decoders run, zoom replaces previews, and hidden/deleted images release their pixels', async () => {
  const pending: (() => void)[] = [], released: string[] = []
  let peak = 0, active = 0
  const cache = new AdaptiveImageCache(async () => new Blob(), () => {}, async (_blob, width, height) => {
    const name = `${width}:${height}`
    peak = Math.max(peak, ++active)
    await new Promise<void>(resolve => pending.push(resolve)); active--
    return { width, height, source: {} as CanvasImageSource, release: () => { released.push(name) } }
  })
  const requests = ['a', 'b', 'c'].map(id => ({ id, width: 300, height: 200 }))
  cache.reconcile(requests); await settle()
  assert.equal(cache.pending, 2)
  pending.splice(0).forEach(resolve => resolve()); await settle()
  pending.splice(0).forEach(resolve => resolve()); await settle()
  assert.equal(cache.size, 3); assert.equal(peak, 2)
  const previous = cache.get('a')
  cache.reconcile([{ id: 'a', width: 1200, height: 800 }]); await settle()
  assert.equal(cache.size, 1); assert.equal(released.length, 2)
  assert.equal(cache.get('a'), previous)
  pending.splice(0).forEach(resolve => resolve()); await settle()
  assert.equal(cache.size, 1); assert.ok(cache.bytes <= IMAGE_CACHE_BYTES)
  assert.notEqual(cache.get('a'), previous)
  assert.equal(released.length, 3)
  cache.reconcile([])
  assert.equal(cache.bytes, 0); assert.equal(released.length, 4)
})

test('late loads and decodes cannot repopulate a deleted asset or a closed board', async () => {
  let complete!: () => void, releases = 0
  const cache = new AdaptiveImageCache(async () => new Blob(), () => {}, async (_blob, width, height) => {
    await new Promise<void>(resolve => { complete = resolve })
    return { width, height, source: {} as CanvasImageSource, release: () => { releases++ } }
  })
  cache.reconcile([{ id: 'deleted', width: 100, height: 100 }]); await settle()
  cache.reconcile([]); complete(); await settle()
  assert.equal(cache.size, 0); assert.equal(releases, 1)
  cache.reconcile([{ id: 'closed', width: 100, height: 100 }]); await settle()
  cache.clear(); complete(); await settle()
  assert.equal(cache.size, 0); assert.equal(releases, 2)
  cache.reconcile([{ id: 'reopened', width: 100, height: 100 }]); await settle()
  complete(); await settle()
  assert.equal(cache.size, 1)
  cache.clear()
})
