import assert from 'node:assert/strict'
import test from 'node:test'
import { readWorkspaceJson, writeWorkspaceJson } from '../lib/workspace-json.ts'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('repairs truncated and empty JSON from the latest copy and preserves damaged bytes', async () => {
  const fs = memoryWorkspace(), path = 'manifests/materials/Ecu/week-1.json'
  const first = { materials: [{id:1}] }, latest = {materials:[{id:1},{id:2}]}
  await writeWorkspaceJson(fs.root, path, first)
  await writeWorkspaceJson(fs.root, path, latest)
  for (const damaged of ['{"materials":[', '']) {
    await fs.put(path, damaged)
    assert.deepEqual(await readWorkspaceJson(fs.root, path, null), latest)
    assert.deepEqual(await fs.json(path), latest)
    const copies = [...fs.files.entries()].filter(([key]) => key.startsWith('.json-recovery/damaged/'))
    assert.ok((await Promise.all(copies.map(([,blob])=>blob.text()))).includes(damaged))
  }
  fs.files.delete(path)
  assert.equal(await readWorkspaceJson(fs.root, path, null), null)
})

test('uses an existing sibling backup and does not erase unrecoverable JSON', async () => {
  const fs = memoryWorkspace(), path = 'manifests/tags.json'
  await fs.put(path, '{bad')
  await assert.rejects(readWorkspaceJson(fs.root, path, {}), /no tiene una copia válida/)
  assert.equal(await fs.files.get(path).text(), '{bad')
  await fs.put('manifests/tags.backup.json', {tags:[{id:'kept'}]})
  assert.deepEqual(await readWorkspaceJson(fs.root, path, {}), {tags:[{id:'kept'}]})
})

test('read-only recovery never writes and BOM JSON seeds a valid recovery copy', async () => {
  const fs = memoryWorkspace(), path = 'manifests/tags.json'
  await fs.put(path, '\uFEFF{"tags":[]}')
  assert.deepEqual(await readWorkspaceJson(fs.root, path, null), {tags:[]})
  await fs.put(path, '{bad')
  const before = [...fs.files.entries()]
  assert.deepEqual(await readWorkspaceJson(fs.root, path, null, true), {tags:[]})
  assert.deepEqual([...fs.files.entries()], before)
})

test('falls back to the previous valid generation if the latest backup is also damaged', async () => {
  const fs = memoryWorkspace(), path = 'manifests/tags.json'
  await writeWorkspaceJson(fs.root, path, {tags:['first']})
  await writeWorkspaceJson(fs.root, path, {tags:['second']})
  await fs.put(path, '{broken')
  await fs.put(`.json-recovery/current/${path}`, '{also-broken')
  assert.deepEqual(await readWorkspaceJson(fs.root, path, null), {tags:['first']})
  assert.deepEqual(await fs.json(path), {tags:['first']})
})
