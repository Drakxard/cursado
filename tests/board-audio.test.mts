import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle=await build({entryPoints:['pizarraproyecto-main/src/audioNotes.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const {BoardAudio}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(t){
  const descriptors=Object.fromEntries(['navigator','MediaRecorder','Audio'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  const streams=[],recorders=[],players=[],urls=new Set(),commits=[]
  let denied=false,fail=false,board='board-one',requests=0,resolvePermission
  const stream=()=>{const value={stopped:false,getTracks(){return [{stop(){value.stopped=true}}]}};streams.push(value);return value}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{requests++;if(denied)throw new Error('Permiso denegado');if(resolvePermission)return new Promise(resolve=>{resolvePermission=()=>resolve(stream())});return stream()}}}})
  globalThis.MediaRecorder=class {
    static isTypeSupported(type){return type==='audio/webm;codecs=opus'}
    constructor(stream,options){this.stream=stream;this.mimeType=options.mimeType;this.options=options;this.state='inactive';recorders.push(this)}
    start(){this.state='recording'}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['opus'],{type:this.mimeType})});this.onstop?.()})}
  }
  globalThis.Audio=class {
    constructor(){this.paused=true;this.currentTime=0;this.duration=20;this.readyState=1;players.push(this)}
    async play(){this.onloadedmetadata?.();this.paused=false}
    pause(){this.paused=true;this.onpause?.()}
    removeAttribute(){this.src=''}
    load(){}
  }
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL
  URL.createObjectURL=()=>{const url='blob:'+Math.random();urls.add(url);return url}
  URL.revokeObjectURL=url=>urls.delete(url)
  const controller=new BoardAudio({boardId:()=>board,load:async()=>new Blob(['audio'],{type:'audio/webm'}),commit:async(item,blob)=>{if(fail)throw new Error('Sin espacio');commits.push({item:structuredClone(item),blob})},changed:()=>{}})
  t.after(()=>{controller.dispose();for(const [key,descriptor]of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}URL.createObjectURL=create;URL.revokeObjectURL=revoke})
  return {controller,streams,recorders,players,urls,commits,set denied(value){denied=value},set fail(value){fail=value},set board(value){board=value},get requests(){return requests},delayPermission(){resolvePermission=true},grant(){resolvePermission()},stream}
}

test('records mono Opus, places once, confirms once and releases the microphone',async t=>{
  const f=fixture(t),c=f.controller
  c.start({x:100,y:150});c.start({x:0,y:0});await tick()
  assert.equal(f.requests,1);assert.equal(c.draft.phase,'recording')
  assert.equal(f.recorders[0].options.audioBitsPerSecond,32000)
  assert.equal(c.move({x:300,y:250}),true);c.place();assert.equal(c.move({x:0,y:0}),false)
  await Promise.all([c.finish(),c.finish()])
  assert.equal(f.commits.length,1);assert.equal(f.streams[0].stopped,true);assert.equal(c.draft,null)
  assert.equal(f.commits[0].item.kind,'audio');assert.equal(f.commits[0].item.x,272)
  assert.equal(f.commits[0].blob.type,'audio/webm;codecs=opus')
})
test('denied permission and cancellation during permission leave no microphone or element',async t=>{
  const f=fixture(t),c=f.controller
  f.denied=true;c.start({x:0,y:0});await tick();assert.equal(c.draft,null);assert.match(c.error,/denegado/)
  f.denied=false;f.delayPermission();c.start({x:0,y:0});c.cancel();f.grant();await tick()
  assert.equal(f.streams[0].stopped,true);assert.equal(c.draft,null);assert.equal(f.commits.length,0)
})
test('recording keeps the actual fallback MIME when Opus is unavailable',async t=>{
  const f=fixture(t),c=f.controller
  MediaRecorder.isTypeSupported=type=>type==='audio/mp4'
  c.start({x:0,y:0});await tick();await c.finish()
  assert.equal(f.commits[0].blob.type,'audio/mp4')
  assert.equal(f.commits[0].item.mimeType,'audio/mp4')
})
test('failed saving retains bytes for retry without reopening the microphone',async t=>{
  const f=fixture(t),c=f.controller
  c.start({x:0,y:0});await tick();f.fail=true
  await assert.rejects(c.finish(),/Sin espacio/)
  const blob=c.draft.blob;assert.equal(c.draft.phase,'error');assert.equal(f.streams[0].stopped,true)
  f.fail=false;await c.finish();assert.equal(f.requests,1);assert.equal(f.commits[0].blob,blob)
})
test('cancel and restart do not allow the previous stop event to close the new microphone',async t=>{
  const f=fixture(t),c=f.controller
  c.start({x:0,y:0});await tick();c.cancel();c.start({x:0,y:0});await tick()
  assert.equal(f.streams[0].stopped,true);assert.equal(f.streams[1].stopped,false)
  c.dispose();assert.equal(f.streams[1].stopped,true)
})
test('playback pauses, resumes, seeks within bounds, resets at end and releases deleted resources',async t=>{
  const f=fixture(t),c=f.controller,item={id:'a',assetId:'a-asset',kind:'audio',durationMs:20000,mimeType:'audio/webm'}
  await c.toggle(item);const player=f.players[0]
  c.seek(item,5);assert.equal(player.currentTime,5);c.seek(item,-10);assert.equal(player.currentTime,0)
  c.seek(item,50);assert.equal(player.currentTime,20);player.currentTime=7
  await c.toggle(item);assert.equal(player.paused,true);await c.toggle(item);assert.equal(player.currentTime,7)
  player.onended();assert.equal(c.playingId,null);assert.equal(player.currentTime,0)
  await c.toggle({...item,id:'b'});assert.equal(f.urls.size,1);assert.equal(player.paused,true)
  c.reconcile([]);assert.equal(f.urls.size,0);assert.equal(c.playingId,null)
})
test('pending audio downloads cannot start playback after disposal or a board change',async t=>{
  const f=fixture(t),c=f.controller
  let resolve;c.options.load=()=>new Promise(done=>{resolve=done})
  const pending=c.toggle({id:'a',assetId:'a',kind:'audio'});c.dispose();resolve(new Blob(['audio']));await pending
  assert.equal(f.players.length,0);assert.equal(f.urls.size,0)
})

test('repeated recording and deletion leave no active tracks or playback URLs',async t=>{
  const f=fixture(t),c=f.controller
  for(let index=0;index<12;index++){
    c.start({x:0,y:0});await tick();await c.finish()
    const item=f.commits[index].item
    await c.toggle(item);assert.equal(f.urls.size,1)
    c.reconcile([])
    assert.equal(f.urls.size,0)
    assert.equal(f.streams.every(stream=>stream.stopped),true)
    assert.equal(f.players.every(player=>player.paused&&!player.src),true)
  }
})
