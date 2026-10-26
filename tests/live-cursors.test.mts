import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileCursors, updateCursor, expireCursors } from '../pizarraproyecto-main/src/liveCursors.ts'
import { sameBoardScene } from '../pizarraproyecto-main/src/storage/sceneContent.ts'

test('reloading a participant replaces their old cursor and closed client IDs are removed', () => {
  const cursors = new Map()
  updateCursor(cursors, {clientId:'old',userId:'peer',updated:100})
  updateCursor(cursors, {clientId:'new',userId:'peer',updated:200})
  assert.deepEqual([...cursors.keys()], ['new'])
  reconcileCursors(cursors, [{id:'peer',client_ids:['reloaded']}])
  assert.equal(cursors.size, 0)
  updateCursor(cursors, {clientId:'reloaded',userId:'peer',updated:300})
  reconcileCursors(cursors, [])
  assert.equal(cursors.size, 0)
})

test('self echoes are ignored and cursors expire when a disconnect notification is lost', () => {
  const cursors = new Map()
  updateCursor(cursors, {clientId:'self-tab',userId:'self',updated:100}, 'self')
  assert.equal(cursors.size, 0)
  updateCursor(cursors, {clientId:'peer-tab',userId:'peer',updated:100})
  assert.equal(expireCursors(cursors, 5000), false)
  assert.equal(expireCursors(cursors, 10101), true)
  assert.equal(cursors.size, 0)
})

test('new transport versions and camera changes leave the scene unchanged', () => {
  const scene = {shapes:[{id:'figure',x:20}],camera:{x:0,y:0,zoom:1},version:1}
  assert.equal(sameBoardScene(scene, {...scene,version:2,camera:{x:400,y:200,zoom:2}}), true)
  assert.equal(sameBoardScene(scene, {...scene,shapes:[{id:'figure',x:21}]}), false)
  assert.equal(sameBoardScene(scene, {...scene,shapes:[]}), false)
  assert.equal(sameBoardScene({camera:{youtubeVideos:[{id:'v'}]}}, {videos:[{id:'v'}]}), true)
})
