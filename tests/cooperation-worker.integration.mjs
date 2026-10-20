import assert from 'node:assert/strict'
import test from 'node:test'
import WebSocket from 'next/dist/compiled/ws/index.js'

const base=process.env.COOP_LOCAL_URL
const socketUrl=url=>base.startsWith('http:')?url.replace('wss:','ws:'):url
test('real Cloudflare runtime: SQLite, R2 multipart, authenticated WebSockets, presence and live editor messages',{skip:!base,timeout:60000},async t=>{
  const origin='https://cursado.vercel.app', suffix=crypto.randomUUID().slice(0,8)
  async function api(path,cookie,body,method=body===undefined?'GET':'POST') {
    const response=await fetch(`${base}/api/${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    assert.ok(response.ok,`${path}: ${response.status} ${await response.clone().text()}`)
    return {response,data:await response.json()}
  }
  const a=await api('auth/guest',null,{name:`LiveA-${suffix}`,password:'test-only'}), b=await api('auth/guest',null,{name:`LiveB-${suffix}`,password:'test-only'})
  const cookieA=a.response.headers.get('set-cookie').split(';')[0], cookieB=b.response.headers.get('set-cookie').split(';')[0]
  const noticeTicket=await api('cooperation/notifications/ticket',cookieB,{})
  const notices=new WebSocket(socketUrl(noticeTicket.data.url),{headers:{Origin:origin}}), noticeMessages=[]
  notices.on('message',bytes=>noticeMessages.push(JSON.parse(bytes.toString())))
  await new Promise((resolve,reject)=>{notices.once('open',resolve);notices.once('error',reject)})
  t.after(()=>notices.terminate())
  const group=await api('cooperation/groups',cookieA,{names:b.data.display_name})
  const sphere=await api('cooperation/spheres',cookieA,{groupId:group.data.id,name:'Live sphere',color:'#2563eb'})
  await api(`cooperation/spheres/${sphere.data.id}/accept`,cookieB,{})
  const connect=async cookie=>{
    const ticket=await api(`cooperation/spheres/${sphere.data.id}/ticket`,cookie,{})
    const socket=new WebSocket(socketUrl(ticket.data.url),{headers:{Origin:origin}})
    const messages=[]
    socket.on('message',bytes=>messages.push(JSON.parse(bytes.toString())))
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
    t.after(()=>socket.terminate())
    return {socket,messages,url:ticket.data.url}
  }
  const wsA=await connect(cookieA),wsB=await connect(cookieB)
  async function waitFor(predicate) {for(let attempt=0;attempt<100;attempt++){const found=predicate();if(found)return found;await new Promise(resolve=>setTimeout(resolve,20))}throw Error('Missing WebSocket event')}
  await waitFor(()=>noticeMessages.find(m=>m.type==='directory_changed'))
  assert.equal((await waitFor(()=>wsA.messages.find(m=>m.type==='presence'&&m.users.length===2))).users.length,2)
  wsA.socket.send(JSON.stringify({type:'editor',document:'study-test',payload:{type:'stroke_start',stroke_id:'one',point:{x:10,y:20},width:2,color:'#000000',user_id:'forged'}}))
  const live=await waitFor(()=>wsB.messages.find(m=>m.type==='editor'))
  assert.equal(live.payload.user_id,a.data.id)
  assert.equal(live.document,'study-test')
  await api(`cooperation/spheres/${sphere.data.id}/operations`,cookieA,{id:crypto.randomUUID(),changes:[{key:'sphere.json',type:'json',value:{subjectId:'live',storageKey:'live',name:'Live sphere'}}]})
  await waitFor(()=>wsB.messages.find(m=>m.type==='changed'&&m.seq===1))
  // More than one multipart part, sent through real streaming DO RPC.
  const bytes=new Uint8Array(9*1024*1024).fill(83), hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')
  const prepared=await api(`cooperation/spheres/${sphere.data.id}/files/${hash}`,cookieA,{size:bytes.length,mime:'application/pdf'})
  const preflight=await fetch(prepared.data.uploadUrl,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'}})
  assert.equal(preflight.status,204)
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin)
  // No session cookie or personal S3 credentials are sent with the large body.
  const upload=await fetch(prepared.data.uploadUrl,{method:'PUT',headers:{Origin:origin,...prepared.data.headers},body:bytes})
  assert.equal(upload.status,200,await upload.text())
  const replay=await fetch(prepared.data.uploadUrl,{method:'PUT',headers:{Origin:origin,...prepared.data.headers},body:bytes})
  assert.equal(replay.status,403,await replay.text())
  await api(`cooperation/spheres/${sphere.data.id}/operations`,cookieA,{id:crypto.randomUUID(),changes:[{key:'teoria/live/test.pdf',type:'blob',blob:{hash,size:bytes.length,mime:'application/pdf'}}]})
  const download=await fetch(`${base}/api/cooperation/spheres/${sphere.data.id}/files/${hash}`,{headers:{Cookie:cookieB}})
  assert.equal(download.status,200)
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',await download.arrayBuffer())).toString('hex'),hash)
  const reused=new WebSocket(socketUrl(wsA.url),{headers:{Origin:origin}})
  const status=await new Promise(resolve=>{reused.on('unexpected-response',(_,response)=>{response.resume();resolve(response.statusCode)});reused.on('error',()=>{})})
  assert.equal(status,403)
  reused.close()
})
