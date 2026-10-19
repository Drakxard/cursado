import { DurableObject } from 'cloudflare:workers'
import { initializeCooperation, cooperationRequest } from './cooperation-directory.js'

const COOKIE = 'pizarra_sid'
const SESSION_SECONDS = 90 * 86400
const PASSWORD_ITERATIONS = 100_000 // Cloudflare's native PBKDF2 ceiling.
const AVATARS = ['😀','😎','🤓','🦊','🐱','🐼','🐸','🐙','🦋','🐝','🚀','🌈','🌻','🍀','⭐','🔥','🎨','🎯','🦄','🐧','🐢','🐺','🧠','👾']
const encoder = new TextEncoder()

export function apiJson(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } })
}
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => { throw new ApiError(status, message) }
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('')
const bytes = value => Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair,16))
const random = length => hex(crypto.getRandomValues(new Uint8Array(length)))
const digest = async value => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)))
const now = () => Math.floor(Date.now()/1000)

function nameOf(value) {
  if (typeof value !== 'string' || Array.from(value).length > 80) fail(422,'Escribí un nombre de hasta 80 caracteres.')
  const name = Array.from(value.replace(/\p{C}/gu,'').trim()).slice(0,40).join('')
  if (!name) fail(422,'Escribí un nombre de usuario.')
  return name
}
const loginName = name => name.normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ').replace(/\s+/gu,' ').trim()
function passwordOf(value) {
  if (typeof value !== 'string' || !value || encoder.encode(value).length > 4096) fail(422,'La contraseña debe tener entre 1 y 4096 bytes.')
  return value
}
function profile(row) {
  return { id:row.id, display_name:row.display_name, color:row.color, is_admin:0, emoji:row.emoji }
}
function sessionToken(request) {
  const parts = (request.headers.get('cookie') || '').split(';').map(part => part.trim())
  const value = parts.find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1) || ''
  return /^[a-f0-9]{64}$/.test(value) ? value : ''
}
function cookie(token, maxAge = SESSION_SECONDS) {
  // Host-only: Next's proxy sets this cookie on cursado.vercel.app.
  return `${COOKIE}=${token}; Path=/pizarra/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
async function passwordKey(password, salt) {
  const material = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits'])
  return crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:PASSWORD_ITERATIONS,hash:'SHA-256'},material,256)
}
async function pepperKey(secret) {
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])
}
async function hashPassword(password,salt,secret) {
  return hex(await crypto.subtle.sign('HMAC',await pepperKey(secret),await passwordKey(password,salt)))
}
async function verifyPassword(password,row,secret) {
  // Unknown names still perform password derivation to avoid a cheap timing oracle.
  const key = await passwordKey(password,row?.password_salt || '00'.repeat(16))
  const verified = await crypto.subtle.verify('HMAC',await pepperKey(secret),bytes(row?.password_hash || '00'.repeat(32)),key)
  return Boolean(row && verified)
}

export class IdentityDirectory extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env)
    this.secret = env.AUTH_PEPPER
    this.sql = ctx.storage.sql
    initializeCooperation(this.sql)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, login_name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      color TEXT NOT NULL, emoji TEXT NOT NULL, password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL, created_at INTEGER NOT NULL)`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)')
    this.sql.exec(`CREATE TABLE IF NOT EXISTS auth_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`)
  }
  first(query,...values) { return this.sql.exec(query,...values).toArray()[0] }
  async limit(category,value,maximum) {
    const key = await digest(`${category}:${value}`), clock = now()
    const current = this.first('SELECT count,expires_at FROM auth_limits WHERE key=?',key)
    if (current?.expires_at > clock && current.count >= maximum) fail(429,'Demasiados intentos. Esperá 15 minutos.')
    this.sql.exec('DELETE FROM auth_limits WHERE expires_at<=?',clock)
    this.sql.exec(`INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1`,key,current?.expires_at > clock ? current.expires_at : clock+900)
  }
  async authenticated(request) {
    const token = sessionToken(request)
    if (!token) fail(401,'Sesión no iniciada')
    const tokenHash = await digest(token)
    const user = this.first(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`,tokenHash,now())
    if (!user) fail(401,'Sesión no iniciada')
    return { user, tokenHash }
  }
  async issue(user) {
    const token = random(32), hash = await digest(token)
    this.sql.exec('DELETE FROM sessions WHERE expires_at<=?',now())
    this.sql.exec('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',hash,user.id,now()+SESSION_SECONDS)
    return apiJson(profile(user),200,{'Set-Cookie':cookie(token)})
  }
  async fetch(request) {
    try {
      if (!this.secret || this.secret.length < 32) fail(503,'El acceso de Pizarra todavía no está configurado.')
      const path = new URL(request.url).pathname, method = request.method
      if (path.startsWith('/api/cooperation/')) return await cooperationRequest(this,request)
      if (path === '/api/auth/me' && method === 'GET') return apiJson(profile((await this.authenticated(request)).user))
      if (path === '/api/library' && method === 'GET') {
        await this.authenticated(request)
        return apiJson({ folders:[], boards:[] }) // No shared boards exist in this auth-only release.
      }
      if ((path === '/api/calendars' || path === '/api/calendar/events') && method === 'GET') {
        const {user} = await this.authenticated(request)
        return apiJson(path === '/api/calendars' ? [{id:`personal:${user.id}`,name:'Personal'}] : [])
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const token = sessionToken(request)
        if (token) this.sql.exec('DELETE FROM sessions WHERE token_hash=?',await digest(token))
        return apiJson({ok:true},200,{'Set-Cookie':cookie('',0)})
      }
      if (method !== 'POST') fail(405,'Método no permitido')
      const body = await request.json().catch(()=>fail(422,'El cuerpo debe ser JSON válido.'))
      if (!body || Array.isArray(body) || typeof body !== 'object') fail(422,'Datos inválidos.')
      if (path === '/api/auth/guest' || path === '/api/auth/login') {
        const displayName = nameOf(body.name), normalized = loginName(displayName), password = passwordOf(body.password)
        await this.limit('login',normalized,12)
        await this.limit('network',request.headers.get('CF-Connecting-IP') || 'proxy',100)
        if (path === '/api/auth/login') {
          const user = this.first('SELECT * FROM users WHERE login_name=?',normalized)
          if (!await verifyPassword(password,user,this.secret)) fail(401,'Nombre o contraseña incorrectos')
          if (this.first('SELECT password_hash FROM users WHERE id=?',user.id)?.password_hash !== user.password_hash) fail(401,'Nombre o contraseña incorrectos')
          return this.issue(user)
        }
        await this.limit('registration',request.headers.get('CF-Connecting-IP') || 'proxy',30)
        if (this.first('SELECT id FROM users WHERE login_name=?',normalized)) fail(409,'Ese nombre ya está ocupado. Elegí otro.')
        if (this.first('SELECT COUNT(*) AS count FROM users').count >= 1000) fail(429,'Límite de usuarios alcanzado.')
        const color = body.color ?? '#6366f1'
        if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) fail(422,'Color inválido')
        if (body.emoji !== null && body.emoji !== undefined && !AVATARS.includes(body.emoji)) fail(422,'Emoji no admitido')
        const user = { id:random(16), display_name:displayName, color, emoji:body.emoji || AVATARS[crypto.getRandomValues(new Uint8Array(1))[0]%AVATARS.length], password_salt:random(16) }
        const passwordHash = await hashPassword(password,user.password_salt,this.secret)
        // Recheck after asynchronous derivation: concurrent registrations must never overwrite an account.
        if (this.first('SELECT id FROM users WHERE login_name=?',normalized)) fail(409,'Ese nombre ya está ocupado. Elegí otro.')
        this.sql.exec('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)',user.id,normalized,user.display_name,user.color,user.emoji,passwordHash,user.password_salt,now())
        return this.issue(user)
      }
      if (path === '/api/auth/avatar' || path === '/api/auth/set-password') {
        const {user,tokenHash} = await this.authenticated(request)
        if (path === '/api/auth/avatar') {
          if (!AVATARS.includes(body.emoji)) fail(422,'Emoji no admitido')
          this.sql.exec('UPDATE users SET emoji=? WHERE id=?',body.emoji,user.id)
          return apiJson({ok:true,emoji:body.emoji})
        }
        const password = passwordOf(body.password), salt = random(16)
        const hash = await hashPassword(password,salt,this.secret)
        const current = await this.authenticated(request)
        if (current.user.password_hash !== user.password_hash) fail(409,'La contraseña cambió durante esta operación. Intentá nuevamente.')
        this.ctx.storage.transactionSync(()=>{
          this.sql.exec('UPDATE users SET password_hash=?,password_salt=? WHERE id=?',hash,salt,user.id)
          this.sql.exec('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',user.id,tokenHash)
        })
        return apiJson({ok:true})
      }
      fail(404,'Ruta no encontrada.')
    } catch (error) {
      return apiJson({detail:error instanceof ApiError ? error.message : error instanceof SyntaxError ? 'El cuerpo debe ser JSON válido.' : 'No se pudo completar el acceso. Intentá nuevamente.'},error instanceof ApiError ? error.status : error instanceof SyntaxError ? 422 : 500)
    }
  }
}
