import assert from 'node:assert/strict'
import test from 'node:test'
import { readJson, scanSphere } from '../lib/client/cooperation-files.ts'
import { withWorkspaceFileLock } from '../lib/workspace-file-lock.ts'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('cooperation reads empty optional manifests, preserves invalid JSON and identifies incomplete shared files', async () => {
  const fs = memoryWorkspace()
  await fs.put('manifests/tags.json', '')
  await fs.put('progreso/pizarras/unused.json', '')
  await fs.put('manifests/subject-voice/pdf/datalab-balanced-json-v1/'+'a'.repeat(64)+'/clef-fragments-v1/regions-html-v2-empty.json','')
  assert.deepEqual(await readJson(fs.root, 'manifests/tags.json', {}), {})
  const binding = { id:'sphere', groupId:'group', subjectId:'ecu', storageKey:'Ecu', sourceId:'ecu', sourceKey:'Ecu', name:'Ecuaciones', color:'#2563eb', owner:true }
  await scanSphere(fs.root, binding)
  await fs.put('teoria/Ecu/uno.pdf',new Blob(['PDF']))
  await fs.put('manifests/materials/Ecu/week-1.json',{materials:[{id:1,drive_file_id:'workspace://teoria/Ecu/uno.pdf',hash:'a'.repeat(64)}],r2:{baseline:{drive_file_id:'workspace://teoria/Other/private.pdf'}}})
  const files=await scanSphere(fs.root,binding)
  assert.equal(files.some(file=>file.key.includes('regions-html-v2-empty')),false)
  assert.equal(files.some(file=>file.key.includes('Other')),false)
  assert.equal(JSON.stringify(files).includes('private.pdf'),false)
  await fs.put('manifests/materials/Ecu/week-1.json',{materials:[{drive_file_id:'workspace://teoria/Other/private.pdf'}]})
  await fs.put('teoria/Other/private.pdf', new Blob(['referenced PDF']))
  await fs.put('teoria/Other/unrelated.pdf', new Blob(['unrelated PDF']))
  const isolated = await scanSphere(fs.root,binding)
  const attachment = isolated.find(file => file.key.startsWith('teoria/Ecu/cooperation-imports/'))!
  assert.equal(await attachment.blob!.text(), 'referenced PDF')
  assert.equal(isolated.some(file => file.key.includes('unrelated')), false)
  const manifest = isolated.find(file => file.key === 'manifests/materials/Ecu/week-1.json')!
  assert.equal((manifest.value as any).materials[0].drive_file_id, `workspace://${attachment.key}`)
  assert.equal((await fs.json('manifests/materials/Ecu/week-1.json')).materials[0].drive_file_id, 'workspace://teoria/Other/private.pdf')
  assert.deepEqual((await scanSphere(fs.root,binding)).map(file=>file.key), isolated.map(file=>file.key))
  await fs.put('manifests/materials/Ecu/week-1.json',{materials:[{drive_file_id:'workspace://User.Services'}]})
  await assert.rejects(scanSphere(fs.root,binding),/fuera de su carpeta/)
  await fs.put('manifests/materials/Ecu/week-1.json', {materials:[{id:1, file_name:'Restaurado.pdf'}]})
  await scanSphere(fs.root, binding)
  await fs.put('manifests/materials/Ecu/week-1.json', '{"materials":')
  await scanSphere(fs.root, binding)
  assert.ok((await fs.json('manifests/materials/Ecu/week-1.json')).materials)
  assert.ok([...fs.files.keys()].some(path => path.startsWith('.json-recovery/damaged/')))
  await fs.put('manifests/materials/Ecu/week-1.json', '')
  await scanSphere(fs.root, binding)
  await fs.put('manifests/materials/Ecu/week-2.json', '{"materials":')
  await assert.rejects(scanSphere(fs.root, binding), /week-2.json.*JSON incompleto/)
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


test('boards with the same sphere name follow their explicit identity instead of leaking between legacy copies', async () => {
  const fs=memoryWorkspace()
  const binding={id:'sphere',groupId:'group',subjectId:'prog3',storageKey:'Prog3',sourceId:'prog3',sourceKey:'Prog3',name:'Prog 3',color:'#ff6600',owner:true}
  await fs.put('progreso/pizarras/original.json',{name:'Prog 3 - Teoria',cooperationSubjectId:'prog3',content:{strokes:[]}})
  await fs.put('progreso/pizarras/copy.json',{name:'Prog 3 - Teoria',cooperationSubjectId:'coop-old',content:{strokes:[]}})
  await fs.put('progreso/pizarras/legacy.json',{name:'Prog 3 - Practica',content:{strokes:[]}})
  const paths=(await scanSphere(fs.root,binding)).map(file=>file.key)
  assert.ok(paths.includes('progreso/pizarras/original.json'))
  assert.ok(paths.includes('progreso/pizarras/legacy.json'))
  assert.equal(paths.includes('progreso/pizarras/copy.json'),false)
})
