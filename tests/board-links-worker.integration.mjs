import assert from 'node:assert/strict'
import test from 'node:test'
import WebSocket from 'next/dist/compiled/ws/index.js'

const base=process.env.COOP_LOCAL_URL
test('link Worker: real sockets authenticate animals, broadcast edits, reject ticket replay and close revoked chains',{skip:!base,timeout:60000},async t=>{
  const origin='https://cursado.vercel.app'
  async function api(path,cookie,body,method=body===undefined?'GET':'POST'){
    const response=await fetch(`${base}/api/board-links${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    assert.ok(response.ok,`${path}: ${response.status} ${await response.clone().text()}`)
    return {response,data:await response.json()}
  }
  const owner=await api('/session',null,{}),guest=await api('/session',null,{})
  const ownerCookie=owner.response.headers.get('set-cookie').split(';')[0],guestCookie=guest.response.headers.get('set-cookie').split(';')[0]
  const a=(await api('/boards',ownerCookie,{source:crypto.randomUUID(),name:'A'})).data.id,b=(await api('/boards',ownerCookie,{source:crypto.randomUUID(),name:'B'})).data.id
  const scene=targets=>({strokes:[],texts:[],media:[],camera:{x:0,y:0,zoom:1},shapes:targets.map(id=>({id,visualType:'board-shortcut',boardReference:{boardId:id,name:id}}))})
  await api(`/boards/${b}`,ownerCookie,{version:0,content:scene([]),files:{}},'PUT')
  await api(`/boards/${a}`,ownerCookie,{version:0,content:scene([b]),files:{}},'PUT')
  const {token}= (await api(`/boards/${a}/link`,ownerCookie,{})).data
  async function connect(id,cookie,link=''){
    const {url}=(await api(`/boards/${id}/ticket${link?`?link=${link}`:''}`,cookie,{})).data
    const socket=new WebSocket(base.startsWith('http:')?url.replace('wss:','ws:'):url,{headers:{Origin:origin}}),messages=[]
    socket.on('message',bytes=>messages.push(JSON.parse(bytes.toString())))
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
    t.after(()=>socket.terminate())
    return {socket,messages,url}
  }
  async function waitFor(predicate){for(let attempt=0;attempt<100;attempt++){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Missing link socket event')}
  const first=await connect(b,ownerCookie),second=await connect(b,guestCookie,token)
  assert.equal((await waitFor(()=>first.messages.find(message=>message.type==='presence'&&message.users.length===2))).users.length,2)
  second.socket.send(JSON.stringify({type:'cursor_move',point:{x:10,y:20},user_id:'forged'}))
  const cursor=await waitFor(()=>first.messages.find(message=>message.type==='cursor_move'))
  assert.equal(cursor.user_id,guest.data.id);assert.equal(cursor.name,guest.data.name)
  await api(`/boards/${b}?link=${token}`,guestCookie,{version:1,content:{...scene([]),texts:[{id:'note',text:'guest'}]},files:{}},'PUT')
  assert.equal((await waitFor(()=>first.messages.find(message=>message.type==='board_version'))).version,2)
  const replay=new WebSocket(base.startsWith('http:')?second.url.replace('wss:','ws:'):second.url,{headers:{Origin:origin}})
  replay.on('error',()=>{})
  assert.equal(await new Promise(resolve=>replay.on('unexpected-response',(_,response)=>{response.resume();resolve(response.statusCode)})),403)
  replay.terminate()
  const closed=new Promise(resolve=>second.socket.once('close',code=>resolve(code)))
  await api(`/boards/${a}`,ownerCookie,{version:1,content:scene([]),files:{}},'PUT')
  assert.equal(await closed,4003,'removing the last path closes an already-open child socket')
  assert.equal((await fetch(`${base}/api/board-links/boards/${b}?link=${token}`,{headers:{Cookie:guestCookie}})).status,403)
  await api(`/boards/${a}`,ownerCookie,{version:2,content:scene([b]),files:{}},'PUT')
  const third=await connect(b,guestCookie,token),revoked=new Promise(resolve=>third.socket.once('close',code=>resolve(code)))
  await api(`/boards/${a}/link`,ownerCookie,undefined,'DELETE')
  assert.equal(await revoked,4003)
  const bytes=new Uint8Array(9*1024*1024).fill(83),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')
  const {uploadUrl}=(await api(`/boards/${b}/files`,ownerCookie,{hash,size:bytes.length,mime:'application/pdf'})).data
  const upload=await fetch(uploadUrl,{method:'PUT',headers:{Origin:origin,'Content-Type':'application/pdf'},body:bytes})
  assert.equal(upload.status,200,await upload.text())
  const replayUpload=await fetch(uploadUrl,{method:'PUT',headers:{Origin:origin,'Content-Type':'application/pdf'},body:bytes})
  assert.equal(replayUpload.status,403,await replayUpload.text(),'an expired ticket must drain the request and deliver its rejection')
  const document=scene([]);document.shapes=[{id:'pdf',visualType:'pdf-shortcut',pdfReference:{materialId:1,subjectId:'test',fileName:'paper.pdf',workspaceFileId:null,sharedFileId:'pdf'}}]
  await api(`/boards/${b}`,ownerCookie,{version:2,content:document,files:{pdf:{hash,mime:'application/pdf',name:'paper.pdf'}}},'PUT')
  const download=await fetch(`${base}/api/board-links/boards/${b}/files/pdf`,{headers:{Cookie:ownerCookie}})
  assert.equal(download.status,200)
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',await download.arrayBuffer())).toString('hex'),hash)
})
