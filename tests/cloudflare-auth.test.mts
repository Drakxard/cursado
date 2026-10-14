import assert from 'node:assert/strict'
import test from 'node:test'
import { authRuntime } from './cloudflare-runtime.mjs'

const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0]
const account = {name:'Rafa',password:'test-password-only',emoji:'🐧',color:'#6366f1'}

test('register, restore after restart, log in with another browser, and revoke a real persistent session',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  assert.equal((await backend.request('/api/auth/me')).status,401)
  const created=await backend.request('/api/auth/guest',{body:account})
  assert.equal(created.status,200)
  assert.match(created.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/)
  assert.match(created.headers.get('set-cookie'),/Path=\/pizarra\//)
  assert.doesNotMatch(created.headers.get('set-cookie'),/Domain=/)
  const user=await created.json(), cookie=cookieOf(created)
  assert.deepEqual(Object.keys(user).sort(),['color','display_name','emoji','id','is_admin'])
  assert.equal(user.is_admin,0)
  const stored=backend.db.prepare('SELECT * FROM users').get()
  assert.notEqual(stored.password_hash,account.password)
  assert.equal(stored.password_hash.length,64)
  assert.notEqual(backend.db.prepare('SELECT token_hash FROM sessions').get().token_hash,cookie.split('=')[1])
  backend.restart()
  assert.deepEqual(await (await backend.request('/api/auth/me',{cookie})).json(),user)
  assert.deepEqual(await (await backend.request('/api/library',{cookie})).json(),{folders:[],boards:[]})
  assert.equal((await backend.request('/api/library')).status,401)
  const login=await backend.request('/api/auth/login',{body:{name:'  ＲＡＦＡ ',password:account.password}})
  assert.equal(login.status,200)
  assert.equal((await login.json()).id,user.id)
  assert.notEqual(cookieOf(login),cookie)
  const logout=await backend.request('/api/auth/logout',{method:'POST',cookie})
  assert.equal(logout.status,200)
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/)
  assert.equal((await backend.request('/api/auth/me',{cookie})).status,401)
  assert.equal((await backend.request('/api/auth/me',{cookie:cookieOf(login)})).status,200)
})

test('wrong passwords, duplicate or concurrent names, expiry, invalid inputs and attempted administrator escalation are rejected',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  const responses=await Promise.all([backend.request('/api/auth/guest',{body:account}),backend.request('/api/auth/guest',{body:{...account,name:'RAFA'}})])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])
  const created=responses.find(r=>r.status===200), cookie=cookieOf(created)
  const wrong=await backend.request('/api/auth/login',{body:{name:account.name,password:'wrong'}})
  const unknown=await backend.request('/api/auth/login',{body:{name:'unknown',password:'wrong'}})
  assert.equal(wrong.status,401);assert.equal(unknown.status,401)
  assert.deepEqual(await wrong.json(),await unknown.json())
  backend.db.prepare('UPDATE sessions SET expires_at=0').run()
  assert.equal((await backend.request('/api/auth/me',{cookie})).status,401)
  for(const body of [{name:'',password:'x'},{name:'new',password:''},{name:'new',password:'x',emoji:'not-an-avatar'},{name:'new',password:'x',color:'javascript:bad'},{name:'new',password:'🔥'.repeat(1500)}]) {
    assert.equal((await backend.request('/api/auth/guest',{body})).status,422)
  }
  const safe=await backend.request('/api/auth/guest',{body:{...account,name:'Another',is_admin:1,id:'forged'}})
  assert.equal(safe.status,200);const safeUser=await safe.json()
  assert.equal(safeUser.is_admin,0);assert.notEqual(safeUser.id,'forged')
})

test('password changes revoke other sessions; avatar changes and attempt limits survive object restart',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  const created=await backend.request('/api/auth/guest',{body:account}), cookie=cookieOf(created)
  const second=await backend.request('/api/auth/login',{body:account}), oldCookie=cookieOf(second)
  assert.equal((await backend.request('/api/auth/avatar',{body:{emoji:'🦊'},cookie})).status,200)
  assert.equal((await (await backend.request('/api/auth/me',{cookie})).json()).emoji,'🦊')
  assert.equal((await backend.request('/api/auth/set-password',{body:{password:'new-test-password'},cookie})).status,200)
  assert.equal((await backend.request('/api/auth/me',{cookie:oldCookie})).status,401)
  assert.equal((await backend.request('/api/auth/me',{cookie})).status,200)
  assert.equal((await backend.request('/api/auth/login',{body:account})).status,401)
  assert.equal((await backend.request('/api/auth/login',{body:{...account,password:'new-test-password'}})).status,200)
  for(let i=0;i<12;i++)assert.equal((await backend.request('/api/auth/login',{body:{name:'limited',password:'wrong'}})).status,401)
  backend.restart()
  assert.equal((await backend.request('/api/auth/login',{body:{name:'limited',password:'wrong'}})).status,429)
})

test('the public Worker rejects cross-site mutations, wrong methods, malformed JSON and oversized streamed bodies before credentials reach storage',async t=>{
  const backend=authRuntime();t.after(()=>backend.close())
  assert.equal((await backend.request('/api/auth/guest',{body:account,headers:{Origin:'https://other.test'}})).status,403)
  assert.equal((await backend.request('/api/auth/guest')).status,405)
  assert.equal((await backend.request('/api/auth/guest',{body:account,headers:{'Content-Type':'text/plain'}})).status,415)
  const headers={Origin:backend.env.CURSADO_ORIGIN,'Content-Type':'application/json'}
  assert.equal((await backend.fetch(new Request('https://backend.test/api/auth/guest',{method:'POST',headers,body:'{bad'}))).status,422)
  assert.equal((await backend.fetch(new Request('https://backend.test/api/auth/guest',{method:'POST',headers,body:'x'.repeat(16385)}))).status,413)
  assert.equal(backend.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,0)
})
