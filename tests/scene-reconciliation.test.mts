import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileRemoteScene, rebaseRemoteHistory } from '../pizarraproyecto-main/src/storage/sceneContent.ts'

test('an unrelated remote shape edit retains graphs, media, nested props and personal camera', () => {
  const graph={id:'graph',x:10,formulas:[{id:'f',expr:'x*x'}],settings:{grid:true}}
  const current={shapes:[{id:'a',x:0},{id:'b',x:30}],graphs:[graph],media:[{id:'image',assetId:'asset'}],camera:{x:100,y:20,zoom:2}}
  const incoming=structuredClone(current);incoming.shapes[1].x=40;incoming.camera.zoom=1
  const next=reconcileRemoteScene(current,incoming)
  assert.equal(next.shapes[0],current.shapes[0])
  assert.notEqual(next.shapes[1],current.shapes[1])
  assert.equal(next.graphs,current.graphs)
  assert.equal(next.media,current.media)
  assert.equal(next.camera,current.camera)
  const moved=structuredClone(incoming);moved.graphs[0].x=20
  const updated=reconcileRemoteScene(next,moved)
  assert.notEqual(updated.graphs[0],graph)
  assert.equal(updated.graphs[0].formulas,graph.formulas)
  assert.equal(updated.graphs[0].settings,graph.settings)
})

test('reordering and deleting remote objects retain surviving identities', () => {
  const current={shapes:[{id:'a',x:0},{id:'b',x:30},{id:'removed',x:50}]}
  const next=reconcileRemoteScene(current,{shapes:[{id:'b',x:30},{id:'a',x:0},{id:'new',x:80}]})
  assert.deepEqual(next.shapes.map(item=>item.id),['b','a','new'])
  assert.equal(next.shapes[0],current.shapes[1])
  assert.equal(next.shapes[1],current.shapes[0])
})

test('undo and redo remain personal after remote additions, removals and property edits', () => {
  const history=[{shapes:[{id:'mine',x:0,fill:'red'},{id:'deleted',x:10}],texts:[]}]
  const before={shapes:[{id:'mine',x:20,fill:'red'},{id:'deleted',x:10}],texts:[]}
  const after={shapes:[{id:'mine',x:20,fill:'blue'},{id:'peer',x:80}],texts:[{id:'peer-text',text:'Remote'}]}
  const rebased=rebaseRemoteHistory(history,before,after)
  assert.deepEqual(rebased[0].shapes,[{id:'mine',x:0,fill:'blue'},{id:'peer',x:80}])
  assert.deepEqual(rebased[0].texts,after.texts)
  assert.deepEqual(history[0].shapes,[{id:'mine',x:0,fill:'red'},{id:'deleted',x:10}],'rebasing does not mutate prior snapshots')
  after.shapes[1].x=999
  after.texts[0].text='later local mutation'
  assert.equal(rebased[0].shapes.find(item=>item.id==='peer')?.x,80)
  assert.deepEqual(rebased[0].texts,[{id:'peer-text',text:'Remote'}],'history does not alias mutable live objects')
})
