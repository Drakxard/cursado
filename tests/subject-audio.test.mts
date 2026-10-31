import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAudioWorkspace, groupAudioPair, moveAudioItem, reorderAudio, removeAudioItem, type AudioWorkspace } from '../lib/subject-audio-model.ts'

const example = (): AudioWorkspace => ({ version: 1, subjectId: 'algebra', folders: [], audios: ['a','b','c'].map(id => ({ id, name: id, parentId: null, path: `subject-voice/audio/algebra/${id}.wav`, duration: 2, transcript: '', transcription: 'pending' })) })
test('group two audios, add another, nest folders and move back to root without changing transcripts', () => {
  const w = example()
  groupAudioPair(w, 'a', 'b', 'Matrices')
  const first = w.folders[0].id
  assert.deepEqual(w.audios.map(a => a.parentId), [first, first, null])
  moveAudioItem(w, 'c', first)
  w.audios[0].transcript = 'Una matriz'; w.audios[0].transcription = 'completed'
  w.folders.push({ id: 'outer', name: 'Álgebra', parentId: null })
  moveAudioItem(w, first, 'outer')
  assert.throws(() => moveAudioItem(w, 'outer', first), /descendientes/)
  assert.throws(() => moveAudioItem(w, first, first), /descendientes/)
  moveAudioItem(w, 'a', null)
  assert.equal(w.audios[0].transcript, 'Una matriz')
  assert.equal(w.audios[0].parentId, null)
  validateAudioWorkspace(w, 'algebra')
})
test('reject missing destinations, foreign paths, duplicate ids and cyclic persisted folders', () => {
  const w = example()
  assert.throws(() => moveAudioItem(w, 'a', 'missing'), /destino/)
  assert.equal(w.audios[0].parentId, null)
  w.audios[0].path = 'subject-voice/audio/other/a.wav'
  assert.throws(() => validateAudioWorkspace(w, 'algebra'), /Archivo/)
  const duplicate = example(); duplicate.audios[1].id = 'a'
  assert.throws(() => validateAudioWorkspace(duplicate, 'algebra'), /inválido/)
  const cycle = example(); cycle.folders = [{ id: 'x', name: 'x', parentId: 'y' }, { id: 'y', name: 'y', parentId: 'x' }]
  assert.throws(() => validateAudioWorkspace(cycle, 'algebra'), /descendientes/)
})
test('invalid grouping leaves original audios untouched', () => {
  const w = example(), before = structuredClone(w)
  assert.throws(() => groupAudioPair(w, 'a', 'a', 'Tema'))
  assert.throws(() => groupAudioPair(w, 'a', 'missing', 'Tema'))
  assert.throws(() => groupAudioPair(w, 'a', 'b', '  '))
  assert.deepEqual(w, before)
})


test('audio positions persist and moving to a target keeps the remaining order', () => {
  const w = example()
  reorderAudio(w,'c','a')
  assert.deepEqual(w.audios.map(audio=>audio.id),['c','a','b'])
  reorderAudio(w,'c','b',true)
  assert.deepEqual(w.audios.map(audio=>audio.id),['a','b','c'])
  w.folders.push({id:'folder',name:'Folder',parentId:null})
  moveAudioItem(w,'b','folder')
  reorderAudio(w,'a','b')
  assert.equal(w.audios.find(audio=>audio.id==='a')!.parentId,'folder')
  assert.deepEqual(validateAudioWorkspace(JSON.parse(JSON.stringify(w)),'algebra'),w)
  const before=structuredClone(w)
  assert.throws(()=>reorderAudio(w,'missing','b'))
  assert.deepEqual(w,before)
})

test('deleting a collection removes its descendants while preserving unrelated audio', () => {
  const w = example()
  w.folders = [{id:'outer',name:'Outer',parentId:null},{id:'inner',name:'Inner',parentId:'outer'}]
  moveAudioItem(w,'a','outer'); moveAudioItem(w,'b','inner')
  assert.deepEqual(removeAudioItem(w,'outer').map(audio=>audio.id),['a','b'])
  assert.equal(w.folders.length,0)
  assert.deepEqual(w.audios.map(audio=>audio.id),['c'])
  validateAudioWorkspace(w,'algebra')
  assert.deepEqual(removeAudioItem(w,'c').map(audio=>audio.id),['c'])
  assert.throws(()=>removeAudioItem(w,'missing'))
})
