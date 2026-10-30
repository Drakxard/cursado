import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAudioWorkspace, groupAudioPair, moveAudioItem, type AudioWorkspace } from '../lib/subject-audio-model.ts'

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
