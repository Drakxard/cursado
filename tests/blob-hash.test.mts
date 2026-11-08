import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { hashBlob } from '../lib/client/blob-hash.ts'

test('streamed fingerprints match SHA-256 for empty, text and binary files', async () => {
  for (const bytes of [new Uint8Array(), new TextEncoder().encode('Numérico: selección y memoria'), Uint8Array.from({ length: 200_000 }, (_, i) => i % 251)]) {
    assert.equal(await hashBlob(new Blob([bytes])), createHash('sha256').update(bytes).digest('hex'))
  }
})

test('a large fingerprint consumes bounded chunks without reading a whole-file buffer', async () => {
  const chunk = Uint8Array.from({ length: 65536 }, (_, i) => i % 251), expected = createHash('sha256')
  const count = 512
  for (let i = 0; i < count; i++) expected.update(chunk)
  let reads = 0
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (reads === count) controller.close(); else { reads++; controller.enqueue(chunk) } } })
  const file = { size: chunk.length * count, stream: () => stream, arrayBuffer() { throw new Error('Whole-file allocation') } } as unknown as Blob
  assert.equal(await hashBlob(file), expected.digest('hex'))
  assert.equal(reads, count)
  assert.equal(stream.locked, false)
})

test('read failures are preserved and release the reader', async () => {
  const failure = new DOMException('File changed', 'NotReadableError')
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(failure) } })
  await assert.rejects(hashBlob({ stream: () => stream } as Blob), error => error === failure)
  assert.equal(stream.locked, false)
})
