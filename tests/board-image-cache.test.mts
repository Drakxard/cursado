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
  await new Promise(resolve => setTimeout(resolve, 170)); await settle()
  pending.splice(0).forEach(resolve => resolve()); await settle()
  assert.equal(cache.size, 1); assert.ok(cache.bytes <= IMAGE_CACHE_BYTES)
  assert.notEqual(cache.get('a'), previous)
  assert.equal(released.length, 3)
  cache.reconcile([])
  assert.equal(cache.bytes, 0); assert.equal(released.length, 4)
})

test('zoom bursts reuse the drawable preview and decode only the settled resolution', async () => {
  let decodes = 0
  const cache = new AdaptiveImageCache(async () => new Blob(), () => {}, async (_blob, width, height) => {
    decodes++
    return { width, height, source: {} as CanvasImageSource, release() {} }
  })
  cache.reconcile([{ id: 'a', width: 300, height: 200 }]); await settle()
  const drawable = cache.get('a')
  for (let width = 550; width < 1800; width += 30) {
    cache.reconcile([{ id: 'a', width, height: width * 2 / 3 }])
    assert.equal(cache.get('a'), drawable)
  }
  assert.equal(decodes, 1)
  await new Promise(resolve => setTimeout(resolve, 180)); await settle()
  assert.equal(decodes, 2)
  cache.clear()
})

test('small originals keep their native dimensions without repeated decoding', async () => {
  const sizes: number[][] = []
  const cache = new AdaptiveImageCache(async () => ({ blob: new Blob(), width: 40, height: 20 }), () => {}, async (_blob, width, height) => {
    sizes.push([width, height]); return { width, height, source: {} as CanvasImageSource, release() {} }
  })
  for (let i = 0; i < 5; i++) { cache.reconcile([{ id: 'a', width: 300, height: 150 }]); await settle() }
  assert.deepEqual(sizes, [[40, 20]])
  cache.clear()
})

test('camera motion within the same level postpones replacement until motion stops', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let decodes = 0
  const cache = new AdaptiveImageCache(async () => new Blob(), () => {}, async (_blob, width, height) => {
    decodes++; return { width, height, source: {} as CanvasImageSource, release() {} }
  })
  cache.reconcile([{ id: 'a', width: 300, height: 200 }], 'initial'); await settle()
  cache.reconcile([{ id: 'a', width: 1000, height: 666 }], 'zoom-start')
  t.mock.timers.tick(100); await settle()
  cache.reconcile([{ id: 'a', width: 1000, height: 666 }], 'pan-continues')
  t.mock.timers.tick(100); await settle()
  assert.equal(decodes, 1)
  t.mock.timers.tick(80); await settle()
  assert.equal(decodes, 2); cache.clear()
})

test('mixed resolutions stay inside the retained budget while replacing previews', async () => {
  let peak = 0
  const cache = new AdaptiveImageCache(async () => new Blob(), () => { peak = Math.max(peak, cache.bytes) }, async (_blob, width, height) =>
    ({ width, height, source: {} as CanvasImageSource, release() {} }))
  const ids = Array.from({ length: 20 }, (_, i) => String(i))
  cache.reconcile(ids.map(id => ({ id, width: 400, height: 300 }))); await settle()
  cache.reconcile(ids.map((id, i) => ({ id, width: i % 2 ? 4000 : 100, height: i % 2 ? 3000 : 75 })))
  await new Promise(resolve => setTimeout(resolve, 180)); await settle()
  assert.equal(cache.size, 20); assert.ok(peak <= IMAGE_CACHE_BYTES)
  cache.clear()
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

test('a generated drawable is reused, and late generated pixels are released on close', async () => {
  let releases = 0, finish!: () => void, wait = false
  const source = {} as CanvasImageSource
  const cache = new AdaptiveImageCache(async () => {
    if (wait) await new Promise<void>(resolve => { finish = resolve })
    return { blob: new Blob(), width: 128, height: 64, decoded: { source, width: 128, height: 64, release() { releases++ } } }
  }, () => {}, async () => { throw new Error('Generated pixels must not be decoded again') })
  cache.reconcile([{ id: 'a', width: 128, height: 64 }]); await settle()
  assert.equal(cache.get('a'), source)
  cache.clear(); assert.equal(releases, 1)
  wait = true; cache.reconcile([{ id: 'b', width: 128, height: 64 }]); await settle()
  cache.clear(); finish(); await settle()
  assert.equal(releases, 2); assert.equal(cache.bytes, 0)
})
