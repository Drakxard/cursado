import assert from 'node:assert/strict'
import test from 'node:test'
import { authRuntime } from './cloudflare-runtime.mjs'
import { reachableBoards } from '../lib/board-link-model.ts'

const scene=(targets:string[]=[],texts:any[]=[])=>({strokes:[],texts,media:[],shapes:targets.map(id=>({id:`shortcut-${id}`,visualType:'board-shortcut',boardReference:{boardId:id,name:id}})),camera:{x:0,y:0,zoom:1}})
const cookieOf=(response:Response)=>response.headers.get('set-cookie')?.split(';')[0]

test('reachability handles cycles, shared descendants and removal of the last path',()=>{
  const edges={a:['b','c'],b:['a','d'],c:['d'],d:[]}
  assert.deepEqual([...reachableBoards('a',id=>edges[id])].sort(),['a','b','c','d'])
  edges.a=['c'];assert.deepEqual([...reachableBoards('a',id=>edges[id])].sort(),['a','c','d'])
  edges.c=[];assert.deepEqual([...reachableBoards('a',id=>edges[id])].sort(),['a','c'])
})

test('persistent links, automatic animal identity, dynamic chains, concurrent saves, revocation and owner boundaries',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  async function api(path:string,cookie:string|undefined,body?:unknown,method?:string){return backend.request(`/api/board-links${path}`,{cookie,body,method:method??(body===undefined?'GET':'POST')})}
  const ownerSession=await api('/session',undefined,{}),ownerCookie=cookieOf(ownerSession)
  const owner=await ownerSession.json()
  assert.match(owner.name,/\S+ [a-f0-9]{4}/);assert.match(ownerSession.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/)
  assert.equal((await(await api('/session',ownerCookie,{})).json()).id,owner.id)
  async function create(source:string,cookie=ownerCookie){const response=await api('/boards',cookie,{source,name:source});assert.ok(response.ok,await response.clone().text());return (await response.json()).id}
  const a=await create('a'),b=await create('b'),c=await create('c'),d=await create('d'),outside=await create('outside')
  assert.equal(await create('a'),a,'source identity is stable')
  const put=async(id:string,version:number,content:any,cookie=ownerCookie,link='')=>api(`/boards/${id}${link?`?link=${link}`:''}`,cookie,{version,content,files:{}},'PUT')
  for(const [id,targets] of [[a,[b,c]],[b,[a,d]],[c,[d]],[d,[]],[outside,[]]] as [string,string[]][])assert.equal((await put(id,0,scene(targets))).status,200)
  const link=(await(await api(`/boards/${a}/link`,ownerCookie,{})).json()).token
  assert.equal((await(await api(`/boards/${a}/link`,ownerCookie,{})).json()).token,link)
  const guestSession=await api('/session',undefined,{}),guestCookie=cookieOf(guestSession)
  const opened=await(await api(`/open?link=${link}`,guestCookie)).json()
  assert.deepEqual(opened.boards.map(v=>v.id).sort(),[a,b,c,d].sort())
  assert.equal((await api(`/boards/${outside}?link=${link}`,guestCookie)).status,403)
  assert.equal((await api(`/boards/${a}/link?link=${link}`,guestCookie,{},'POST')).status,403)
  assert.equal((await put(d,1,scene([], [{id:'guest-note',text:'hola'}]),guestCookie,link)).status,200)
  assert.equal((await put(d,1,scene(),guestCookie,link)).status,409)
  assert.equal((await put(d,2,scene([outside]),guestCookie,link)).status,403,'guessing another board ID grants no permission')
  assert.equal((await put(a,1,scene([c]))).status,200)
  assert.equal((await api(`/boards/${b}?link=${link}`,guestCookie)).status,403)
  assert.equal((await api(`/boards/${d}?link=${link}`,guestCookie)).status,200,'a second path still grants access')
  assert.equal((await put(c,1,scene())).status,200)
  assert.equal((await api(`/boards/${d}?link=${link}`,guestCookie)).status,403)
  assert.equal((await put(c,2,scene([d]))).status,200)
  assert.equal((await api(`/boards/${d}?link=${link}`,guestCookie)).status,200)
  backend.restart()
  assert.equal((await api(`/boards/${d}?link=${link}`,guestCookie)).status,200)
  assert.equal((await api(`/boards/${a}/link`,ownerCookie,undefined,'DELETE')).status,200)
  assert.equal((await api(`/open?link=${link}`,guestCookie)).status,403)
  assert.equal((await put(a,2,scene(),guestCookie,link)).status,403)
  const next=(await(await api(`/boards/${a}/link`,ownerCookie,{})).json()).token
  assert.notEqual(next,link)
  assert.equal((await api(`/open?link=${link}`,guestCookie)).status,403)
  assert.equal((await api(`/open?link=${next}`,guestCookie)).status,200)
})

test('account names override anonymous identity; forged identity headers never authorize a board',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  const created=await backend.request('/api/auth/guest',{body:{name:'Cuenta para compartir',password:'test-only'}})
  const cookie=cookieOf(created),user=await created.json()
  const session=await backend.request('/api/board-links/session',{cookie,body:{}})
  const profile=await session.json();assert.equal(profile.id,user.id);assert.equal(profile.name,user.display_name)
  const board=await(await backend.request('/api/board-links/boards',{cookie,body:{source:'private',name:'Private'}})).json()
  const forged=await backend.request(`/api/board-links/boards/${board.id}`,{headers:{'X-Board-Link-Identity':encodeURIComponent(JSON.stringify(profile))}})
  assert.equal(forged.status,401)
  const anonymous=await backend.request('/api/board-links/session',{body:{}}),anonymousCookie=cookieOf(anonymous)
  const original=await(await backend.request('/api/board-links/boards',{cookie:anonymousCookie,body:{source:'before-login',name:'Original'}})).json()
  assert.equal((await backend.request(`/api/board-links/boards/${original.id}`,{cookie:`${cookie}; ${anonymousCookie}`})).status,200,'signing in preserves ownership created on this device')
})

test('PDFs and images require verified uploads and remain scoped to the current chain',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  const session=await backend.request('/api/board-links/session',{body:{}}),cookie=cookieOf(session)
  const api=async(path:string,body?:unknown,method?:string)=>backend.request(`/api/board-links${path}`,{cookie,body,method:method??(body===undefined?'GET':'POST')})
  const {id}=await(await api('/boards',{source:'pdf',name:'PDF'})).json()
  const bytes=new TextEncoder().encode('%PDF-1.7 test'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')
  const content:any=scene();content.shapes=[{id:'pdf',visualType:'pdf-shortcut',pdfReference:{materialId:1,subjectId:'x',fileName:'test.pdf',workspaceFileId:null,sharedFileId:'pdf_test'}}]
  const files={pdf_test:{hash,mime:'application/pdf',name:'test.pdf'}}
  assert.equal((await api(`/boards/${id}`,{version:0,content,files},'PUT')).status,403)
  const prepared=await(await api(`/boards/${id}/files`,{hash,size:bytes.length,mime:'application/pdf'})).json()
  const preflight=await backend.fetch(new Request(prepared.uploadUrl,{method:'OPTIONS',headers:{Origin:backend.env.CURSADO_ORIGIN}}))
  assert.equal(preflight.status,204)
  const upload=()=>backend.fetch(new Request(prepared.uploadUrl,{method:'PUT',headers:{Origin:backend.env.CURSADO_ORIGIN,'Content-Type':'application/pdf'},body:bytes}))
  assert.equal((await upload()).status,200);assert.equal((await upload()).status,403)
  assert.equal((await api(`/boards/${id}`,{version:0,content,files},'PUT')).status,200)
  const link=(await(await api(`/boards/${id}/link`,{})).json()).token
  const guest=cookieOf(await backend.request('/api/board-links/session',{body:{}}))
  const get=()=>backend.request(`/api/board-links/boards/${id}/files/pdf_test?link=${link}`,{cookie:guest})
  assert.equal(await(await get()).text(),'%PDF-1.7 test')
  assert.equal((await backend.request(`/api/board-links/boards/${id}/files/unknown?link=${link}`,{cookie:guest})).status,404)
  const expanded={...scene(),media:[1,2].map(pageNumber=>({id:`page-${pageNumber}`,assetId:'pdf_test',name:'test.pdf',kind:'pdf-page',pdfSource:true,pageNumber,documentId:'pdf_test',groupId:'document'}))}
  assert.equal((await api(`/boards/${id}`,{version:1,content:expanded,files},'PUT')).status,200)
  assert.equal((await get()).status,200,'expanded pages retain the same authorized PDF bytes')
  const invalid=structuredClone(expanded);invalid.media[0].pageNumber=0
  assert.equal((await api(`/boards/${id}`,{version:2,content:invalid,files},'PUT')).status,422)
  assert.equal((await api(`/boards/${id}`,{version:2,content:scene(),files:{}},'PUT')).status,200)
  assert.equal((await get()).status,404)
})
