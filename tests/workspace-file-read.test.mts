import assert from 'node:assert/strict'
import test from 'node:test'
import { readWorkspaceFileText } from '../lib/workspace-file-read.ts'

test('reacquires a file snapshot invalidated by a concurrent save', async () => {
  // A transferred handle may reject with an exception from another frame.
  for (const failure of [new DOMException('Snapshot changed', 'NotReadableError'), { name: 'NotReadableError' }]) {
  let reads = 0
  const handle = { getFile: async () => ({ text: async () => {
    if (++reads === 1) throw failure
    return '{"version":2}'
  } }) } as Pick<FileSystemFileHandle, 'getFile'>
  assert.equal(await readWorkspaceFileText(handle), '{"version":2}')
  assert.equal(reads, 2)
  }
})

test('preserves permission errors and bounds retries for persistent read errors', async () => {
  for (const name of ['NotAllowedError', 'NotReadableError']) {
    let reads = 0
    const error = new DOMException('Cannot read', name)
    const handle = { getFile: async () => { reads++; throw error } }
    await assert.rejects(readWorkspaceFileText(handle), candidate => candidate === error)
    assert.equal(reads, name === 'NotReadableError' ? 3 : 1)
  }
})
