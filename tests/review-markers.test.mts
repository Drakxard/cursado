import assert from 'node:assert/strict'
import test from 'node:test'
import {createReviewMarker,adjacentReviewMarker} from '../pizarraproyecto-main/src/canvas/reviewMarkers.ts'

test('review markers have persistent identity and geometry centered on the cursor',()=>{
  const marker=createReviewMarker('review-one',{x:100,y:200})
  assert.deepEqual(JSON.parse(JSON.stringify(marker)),{id:'review-one',kind:'circle',visualType:'review-marker',x:72,y:172,width:56,height:56,color:'#202020',strokeWidth:3.5})
})
test('review navigation wraps in creation order, skips other objects and adapts to deletion',()=>{
  const a=createReviewMarker('a',{x:900,y:800}),b=createReviewMarker('b',{x:50,y:50}),c=createReviewMarker('c',{x:400,y:500})
  const shapes=[a,{...a,id:'other',visualType:'page' as const},b,c]
  assert.equal(adjacentReviewMarker(shapes,'a',1)?.id,'b')
  assert.equal(adjacentReviewMarker(shapes,'c',1)?.id,'a')
  assert.equal(adjacentReviewMarker(shapes,'a',-1)?.id,'c')
  assert.equal(adjacentReviewMarker(shapes.filter(item=>item.id!=='b'),'a',1)?.id,'c')
  assert.equal(adjacentReviewMarker([a],'a',1)?.id,'a')
  assert.equal(adjacentReviewMarker(shapes,'missing',1),null)
  assert.equal(adjacentReviewMarker([],'a',-1),null)
})
