import test from 'node:test'
import assert from 'node:assert/strict'
import { scanSphere, applyMirrorFile } from '../lib/client/cooperation-files.ts'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'
import { validateAudioWorkspace } from '../lib/subject-audio-model.ts'

test('sphere mirrors include audio binaries, nested locations and transcripts with subject isolation', async () => {
  const fs = memoryWorkspace()
  const workspace = { version: 1, subjectId: 'algebra', folders: [{ id:'group',name:'Matrices',parentId:null }], audios: [{ id:'audio',name:'Matrices',parentId:'group',path:'subject-voice/audio/algebra/audio.wav',duration:1,transcript:'Una matriz',transcription:'completed' }] }
  await fs.put('manifests/subject-voice/algebra/audios.json',workspace)
  await fs.put('subject-voice/audio/algebra/audio.wav',new Blob(['wav'],{type:'audio/wav'}))
  await fs.put('subject-voice/audio/other/private.wav',new Blob(['private']))
  const owner = { id:'sphere',groupId:'group',subjectId:'algebra',storageKey:'Algebra',sourceId:'algebra',sourceKey:'Algebra',name:'Álgebra',color:'#2563eb',owner:true }
  const files = await scanSphere(fs.root,owner)
  assert.equal(files.some(file=>file.key.includes('private')),false)
  assert.equal(await files.find(file=>file.key==='subject-voice/audio/algebra/audio.wav')!.blob!.text(),'wav')
  const replica = memoryWorkspace(), binding = { ...owner,subjectId:'copy',storageKey:'Copy',owner:false }
  for(const file of files) await applyMirrorFile(replica.root,binding,file.key,(file.value ?? file.blob)!)
  const copied = validateAudioWorkspace(await replica.json('manifests/subject-voice/copy/audios.json'),'copy')
  assert.equal(copied.audios[0].parentId,'group')
  assert.equal(copied.audios[0].transcript,'Una matriz')
  assert.equal(copied.audios[0].path,'subject-voice/audio/copy/audio.wav')
  assert.equal(await replica.files.get(copied.audios[0].path)!.text(),'wav')
  await assert.rejects(applyMirrorFile(replica.root,binding,'subject-voice/audio/other/private.wav',new Blob(['private'])),/pertenece/)
})
