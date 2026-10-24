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


test('repairs obsolete cooperative paths only with verified sphere content and persists the local reference', async () => {
  const fs=memoryWorkspace()
  const {digest}=await import('../lib/client/cooperation-files.ts')
  const binding={id:'sphere',groupId:'group',subjectId:'prog3',storageKey:'Prog3',sourceId:'prog3',sourceKey:'Prog3',name:'Prog 3',color:'#ff6600',owner:true}
  const pdf=new Blob(['verified PDF']),hash=await digest(pdf)
  const key='teoria/Prog3/week-28/file.pdf',old='teoria/Cooperativo-old/week-28/file.pdf'
  const resource={key,type:'blob',blob:{hash,size:pdf.size,mime:'application/pdf'}}
  await fs.put(key,pdf)
  await fs.put('manifests/materials/Prog3/week-28.json',{materials:[{id:1,drive_file_id:`workspace://${old}`}],r2:{personal:'keep'}})
  const files=await scanSphere(fs.root,binding,{resources:{[key]:resource}})
  assert.equal((await fs.json('manifests/materials/Prog3/week-28.json')).materials[0].drive_file_id,`workspace://${key}`)
  assert.deepEqual((await fs.json('manifests/materials/Prog3/week-28.json')).r2,{personal:'keep'})
  assert.equal(files.some(file=>file.key.includes('cooperation-imports')),false)
  fs.files.delete(key)
  let restored=0
  await scanSphere(fs.root,binding,{resources:{[key]:resource},restore:async(_resource,path)=>{restored++;await fs.put(path,pdf)}})
  assert.equal(restored,1)
  await fs.put(key,new Blob(['different file']))
  await fs.put('manifests/materials/Prog3/week-28.json',{materials:[{id:1,drive_file_id:`workspace://${old}`}]})
  await assert.rejects(scanSphere(fs.root,binding,{resources:{[key]:resource}}),/No se encuentra el archivo/)
  assert.equal(await fs.files.get(key).text(),'different file')
})

test('reference repairs cannot overwrite a manifest edited during recovery', async () => {
  const fs=memoryWorkspace(),{digest}=await import('../lib/client/cooperation-files.ts')
  const binding={id:'sphere',groupId:'group',subjectId:'prog3',storageKey:'Prog3',sourceId:'prog3',sourceKey:'Prog3',name:'Prog 3',color:'#ff6600',owner:true}
  const pdf=new Blob(['verified PDF']),key='teoria/Prog3/file.pdf',path='manifests/materials/Prog3/week-1.json'
  const resource={key,type:'blob',blob:{hash:await digest(pdf),size:pdf.size,mime:'application/pdf'}}
  await fs.put(path,{materials:[{id:1,drive_file_id:'workspace://teoria/Cooperativo-old/file.pdf'}]})
  const edited={materials:[{id:2,file_name:'new local edit'}]}
  await assert.rejects(scanSphere(fs.root,binding,{resources:{[key]:resource},restore:async()=>{await fs.put(key,pdf);await fs.put(path,edited)}}),error=>error instanceof Error && error.name==='NotReadableError')
  assert.deepEqual(await fs.json(path),edited)
})

test('obsolete PDF shortcuts do not block a sphere, but missing material attachments still do', async () => {
  const fs = memoryWorkspace()
  const binding = { id:'sphere', groupId:'group', subjectId:'prog3', storageKey:'Prog 3', sourceId:'prog3', sourceKey:'Prog 3', name:'Prog 3', color:'#ff6600', owner:true }
  const old = 'workspace://practica/Prog 3/week-23/deleted.pdf'
  const foreign = 'workspace://practica/Old subject/deleted.pdf'
  const board = { cooperationSubjectId:'prog3', content:{ shapes:[old, foreign].map(workspaceFileId => ({ visualType:'pdf-shortcut', pdfReference:{workspaceFileId} })) } }
  await fs.put('progreso/pizarras/board.json', board)
  await fs.put('practica/Prog 3/current.pdf', new Blob(['current PDF']))
  let restores = 0
  const files = await scanSphere(fs.root, binding, {restore:async () => { restores++; throw new Error('Offline') }})
  assert.equal(restores, 0)
  assert.equal(files.some(file => file.key === 'practica/Prog 3/current.pdf'), true)
  assert.deepEqual((files.find(file => file.key === 'progreso/pizarras/board.json')!.value as any).content, board.content)
  assert.deepEqual(await fs.json('progreso/pizarras/board.json'), board)
  await fs.put('manifests/materials/Prog 3/week-23.json', { materials:[{drive_file_id:old}] })
  await assert.rejects(scanSphere(fs.root, binding), /No se encuentra el archivo/)
})

test('scanning derived PDF JSON reads it without creating another recovery tree', async () => {
  const fs = memoryWorkspace(), hash = 'a'.repeat(64)
  const binding = { id:'sphere', groupId:'group', subjectId:'ecu', storageKey:'Ecu', sourceId:'ecu', sourceKey:'Ecu', name:'Ecu', color:'#2563eb', owner:true }
  const path = `manifests/subject-voice/pdf/datalab-balanced-json-v1/${hash}/clef-fragments-v1/${'b'.repeat(64)}.json`
  await fs.put('manifests/materials/Ecu/week-1.json', { materials:[{hash}] })
  await fs.put(path, { results:[1,2] })
  const files = await scanSphere(fs.root, binding)
  assert.deepEqual(files.find(file => file.key === path)!.value, {results:[1,2]})
  assert.equal([...fs.files.keys()].some(key => key.startsWith('.json-recovery/') && key.includes('subject-voice')), false)
})
