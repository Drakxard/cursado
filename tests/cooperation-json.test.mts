import assert from 'node:assert/strict'
import test from 'node:test'
import { readJson, scanSphere } from '../lib/client/cooperation-files.ts'
import { withWorkspaceFileLock } from '../lib/workspace-file-lock.ts'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('cooperation reads empty optional manifests, preserves invalid JSON and identifies incomplete shared files', async () => {
  const fs = memoryWorkspace()
  await fs.put('manifests/tags.json', '')
  await fs.put('progreso/pizarras/unused.json', '')
  assert.deepEqual(await readJson(fs.root, 'manifests/tags.json', {}), {})
  const binding = { id:'sphere', groupId:'group', subjectId:'ecu', storageKey:'Ecu', sourceId:'ecu', sourceKey:'Ecu', name:'Ecuaciones', color:'#2563eb', owner:true }
  await scanSphere(fs.root, binding)
  await fs.put('manifests/materials/Ecu/week-1.json', '{"materials":')
  await assert.rejects(scanSphere(fs.root, binding), /manifests\/materials\/Ecu\/week-1.json.*JSON incompleto/)
  assert.equal(await fs.files.get('manifests/materials/Ecu/week-1.json').text(), '{"materials":')
  await fs.put('manifests/materials/Ecu/week-1.json', '')
  await assert.rejects(scanSphere(fs.root, binding), /week-1.json.*vacío/)
})

test('cooperation waits for a local manifest save instead of reading its temporary empty file', async () => {
  const fs = memoryWorkspace(), path = 'manifests/tags.json'
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release=resolve })
  const ready = new Promise<void>(resolve => { started=resolve })
  const write = withWorkspaceFileLock(`write:${path}`, async () => {
    await fs.put(path, '')
    started(); await gate
    await fs.put(path, {tags:[{id:'kept'}]})
  })
  await ready
  const reading = readJson(fs.root, path, {})
  release(); await write
  assert.deepEqual(await reading, {tags:[{id:'kept'}]})
})
