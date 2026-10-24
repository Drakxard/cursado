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

test('long Windows cache paths use compact recovery names and keep both valid generations', async () => {
  const fs = memoryWorkspace()
  const path = `manifests/subject-voice/pdf/datalab-balanced-json-v1/${'a'.repeat(64)}/clef-fragments-v1/${'b'.repeat(64)}.json`
  const root = 'D:/Users/Rafael/Desktop/pizarra/'
  function windowsDirectory(directory: FileSystemDirectoryHandle, prefix = ''): FileSystemDirectoryHandle {
    const check = (name: string) => {
      const target = prefix + name
      if ((root + target).length >= 260) throw new DOMException('Windows path too long', 'NotFoundError')
      return target
    }
    return {
      ...directory,
      async getDirectoryHandle(name, options) { return windowsDirectory(await directory.getDirectoryHandle(name, options), check(name) + '/') },
      async getFileHandle(name, options) { check(name); return directory.getFileHandle(name, options) },
    }
  }
  const handle = windowsDirectory(fs.root)
  await fs.put(path, { version: 1 })
  assert.deepEqual(await readWorkspaceJson(handle, path, null), { version: 1 })
  await writeWorkspaceJson(handle, path, { version: 2 })
  await fs.put(path, '{broken')
  assert.deepEqual(await readWorkspaceJson(handle, path, null), { version: 2 })
  const backup = [...fs.files.keys()].find(key => key.startsWith('.json-recovery/current/by-path/'))!
  await fs.put(path, '{broken again')
  await fs.put(backup, '{broken backup')
  assert.deepEqual(await readWorkspaceJson(handle, path, null), { version: 1 })
  assert.ok([...fs.files.keys()].every(key => (root + key).length < 260))
})

test('recovers PDF caches from their existing .json.backup files', async () => {
  const fs = memoryWorkspace(), path = 'manifests/subject-voice/pdf/cache.json'
  await fs.put(path, '{broken')
  await fs.put(path + '.backup', { kept: true })
  assert.deepEqual(await readWorkspaceJson(fs.root, path, null), { kept: true })
})
