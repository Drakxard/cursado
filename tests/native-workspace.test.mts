import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeSnapshot, nativeWorkspaceRoot } from '../lib/native-workspace.ts'

const manifest = { version: 1 as const, workspaceId:'workspace-native-test',revision:'revision-native-test',name:'Biblioteca',publishedAt:'2026-10-17T12:00:00Z',subjects:[],items:[],files:[{id:'a'.repeat(64),hash:'b'.repeat(64),size:4,mime:'text/plain',path:'teoria/materia/a.txt'}] }
test('native directory enumerates the pinned revision and rejects all writes and traversal', async () => {
  const root = nativeWorkspaceRoot({bridgeVersion:1,linked:true,manifest})
  assert.deepEqual(await Array.fromAsync(root.keys()), ['teoria'])
  const theory = await root.getDirectoryHandle('teoria')
  const subject = await theory.getDirectoryHandle('materia')
  assert.deepEqual(await Array.fromAsync(subject.keys()), ['a.txt'])
  const file = await subject.getFileHandle('a.txt')
  await assert.rejects(() => file.createWritable(), {name:'NotAllowedError'})
  await assert.rejects(() => subject.removeEntry('a.txt'), {name:'NotAllowedError'})
  await assert.rejects(() => root.getDirectoryHandle('teoria', {create:true}), {name:'NotAllowedError'})
  await assert.rejects(() => root.getDirectoryHandle('../privado'), TypeError)
  await assert.rejects(() => root.getFileHandle('User.Services'), {name:'NotFoundError'})
  await assert.rejects(() => subject.getFileHandle('missing'), {name:'NotFoundError'})
})
test('native file reads use revision URLs and report missing downloads', async () => {
  const original = globalThis.fetch
  try {
    let requested = ''
    globalThis.fetch = async input => { requested=String(input);return new Response('hola') }
    const root = nativeWorkspaceRoot({bridgeVersion:1,linked:true,manifest})
    const file = await (await (await root.getDirectoryHandle('teoria')).getDirectoryHandle('materia')).getFileHandle('a.txt')
    assert.equal(await (await file.getFile()).text(),'hola')
    assert.equal(requested,`/files/${manifest.revision}/${manifest.files[0].id}`)
    globalThis.fetch = async () => new Response('',{status:503})
    await assert.rejects(() => file.getFile(),/pendiente de descarga/)
  } finally {globalThis.fetch=original}
})
test('native startup rejects incompatible bridge versions', () => {
  const original = globalThis.window
  try {
    Object.assign(globalThis,{window:{CursadoNative:{snapshot:()=>JSON.stringify({bridgeVersion:2,linked:true})}}})
    assert.throws(nativeSnapshot,/Actualizá InScreen/)
    assert.throws(() => nativeWorkspaceRoot({bridgeVersion:1,linked:false}),/Vinculá/)
  } finally {Object.assign(globalThis,{window:original})}
})
