import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { ImagePreviewStore, previewLevel } from '../src/canvas/imagePreviewStore'
import { imageDimensions } from '../src/canvas/imageDimensions'

describe('disposable image previews', () => {
  it('evicts least recently used encoded blobs with metadata, without touching originals', async () => {
    const name = `previews-${crypto.randomUUID()}`, store = new ImagePreviewStore(10, name)
    const asset = { blob: new Blob(['12345']), width: 10, height: 5 }
    vi.spyOn(Date, 'now').mockReturnValue(1)
    await store.put('a', asset)
    vi.mocked(Date.now).mockReturnValue(2); await store.put('b', asset)
    vi.mocked(Date.now).mockReturnValue(3); expect(await store.get('a')).toBeDefined()
    vi.mocked(Date.now).mockReturnValue(4); await store.put('c', asset)
    expect(await store.get('b')).toBeUndefined()
    expect(await store.get('a')).toMatchObject({ width: 10, height: 5 })
    const db = await openDB(name, 2)
    expect(await db.getAllKeys('blobs')).toEqual(['a', 'c'])
    expect((await db.getAll('metadata')).reduce((sum, entry) => sum + entry.bytes, 0)).toBe(10)
    expect(await db.get('state', 'bytes')).toBe(10)
    db.close(); vi.restoreAllMocks()
  })

  it('replaces an entry without double counting and skips files over the disk budget', async () => {
    const name = `previews-${crypto.randomUUID()}`, store = new ImagePreviewStore(10, name)
    await store.put('a', { blob: new Blob(['123456']), width: 20, height: 10 })
    await store.put('a', { blob: new Blob(['123']), width: 10, height: 5 })
    await store.put('b', { blob: new Blob(['1234567']), width: 10, height: 5 })
    await store.put('too-large', { blob: new Blob(['12345678901']), width: 10, height: 5 })
    expect(await store.get('a')).toBeDefined(); expect(await store.get('b')).toBeDefined()
    expect(await store.get('too-large')).toBeUndefined()
  })

  it('upgrades the disposable v1 schema and initializes the size counter', async () => {
    const name = `previews-${crypto.randomUUID()}`
    const db = await openDB(name, 1, { upgrade(db) {
      db.createObjectStore('metadata', { keyPath: 'key' }).createIndex('used', 'used')
      db.createObjectStore('blobs')
    } })
    await db.put('metadata', { key: 'old', width: 10, height: 5, bytes: 6, used: 1 })
    await db.put('blobs', new Blob(['123456']), 'old'); db.close()
    const store = new ImagePreviewStore(10, name)
    expect(await store.get('old')).toBeDefined()
    await store.put('new', { blob: new Blob(['12345']), width: 10, height: 5 })
    expect(await store.get('old')).toBeUndefined()
    expect(await store.get('new')).toBeDefined()
  })

  it('continues when storage cannot be opened', async () => {
    const store = new ImagePreviewStore(10, `previews-${crypto.randomUUID()}`)
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    await expect(store.get('a')).resolves.toBeUndefined()
    await expect(store.put('a', { blob: new Blob(['1']), width: 1, height: 1 })).resolves.toBeUndefined()
    open.mockRestore()
  })

  it('uses bounded resolution levels', () => {
    expect([1, 256, 257, 513, 1025, 2049, 9000].map(side => previewLevel(side))).toEqual([256, 256, 512, 1024, 2048, 4096, 4096])
    expect(previewLevel(513, 512)).toBe(512)
    expect(previewLevel(510, 1024)).toBe(1024)
    expect(previewLevel(400, 1024)).toBe(512)
  })

  it('reads PNG dimensions without creating decoded image elements', async () => {
    const bytes = new Uint8Array(24), view = new DataView(bytes.buffer)
    view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a)
    view.setUint32(16, 4000); view.setUint32(20, 3000)
    expect(await imageDimensions(new Blob([bytes]))).toEqual({ width: 4000, height: 3000 })
  })

  it('reads JPEG dimensions and respects an EXIF rotation without full decoding', async () => {
    const bytes = new Uint8Array(50), view = new DataView(bytes.buffer)
    view.setUint16(0, 0xffd8); view.setUint16(2, 0xffe1); view.setUint16(4, 34)
    view.setUint32(6, 0x45786966); view.setUint16(12, 0x4949)
    view.setUint16(14, 42, true); view.setUint32(16, 8, true)
    view.setUint16(20, 1, true); view.setUint16(22, 0x112, true)
    view.setUint16(24, 3, true); view.setUint32(26, 1, true); view.setUint16(30, 6, true)
    view.setUint16(38, 0xffc0); view.setUint16(40, 8); bytes[42] = 8
    view.setUint16(43, 3000); view.setUint16(45, 4000)
    expect(await imageDimensions(new Blob([bytes]))).toEqual({ width: 3000, height: 4000 })
  })
})
