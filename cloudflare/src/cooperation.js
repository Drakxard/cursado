import { DurableObject } from 'cloudflare:workers'
import { mergeCooperation, safeCooperationPath } from '../../lib/cooperation-model.ts'
import { Sha256 } from '@aws-crypto/sha256-js'

const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'private, no-store'}})
const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x=>x.toString(16).padStart(2,'0')).join('')
export class SharedContentRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx,env)
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, value TEXT NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS upload_tickets (hash TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)')
  }
  async checkStorage() {return this.sql.exec('SELECT 1 AS ready').one().ready === 1}
  cancelled() {return !!this.sql.exec("SELECT id FROM state WHERE id='cancelled'").toArray().length}
  cancelPublication(ownerId) {
    if(this.sql.exec('SELECT value FROM operations').toArray().some(row=>JSON.parse(row.value).userId!==ownerId))return {error:'La esfera ya recibió cambios de otra persona. No se puede deshacer este intento.',status:409}
    this.sql.exec("INSERT OR REPLACE INTO state VALUES ('cancelled','true')")
    this.sql.exec('DELETE FROM tickets');this.sql.exec('DELETE FROM upload_tickets')
    for(const socket of this.ctx.getWebSockets())try{socket.close(1008,'Cooperación deshecha')}catch{}
    return {ok:true}
  }
  read() {
    const chunks=this.sql.exec("SELECT value FROM state WHERE id LIKE 'snapshot-%' ORDER BY id").toArray()
    if(chunks.length)return JSON.parse(chunks.map(row=>row.value).join(''))
    const row=this.sql.exec("SELECT value FROM state WHERE id='snapshot'").toArray()[0]
    return row ? JSON.parse(row.value) : {seq:0,resources:{},conflicts:[]}
  }
  write(state) {
    // SQLite has a per-row limit; never put an entire sphere in one row.
    const text=JSON.stringify(state)
    this.sql.exec("DELETE FROM state WHERE id LIKE 'snapshot%'")
    for(let offset=0,part=0;offset<text.length;part++) {
      let end=Math.min(offset+32768,text.length)
      const last=text.charCodeAt(end-1)
      if(end<text.length && last>=0xd800 && last<=0xdbff)end--
      this.sql.exec('INSERT INTO state VALUES (?,?)',`snapshot-${String(part).padStart(8,'0')}`,text.slice(offset,end))
      offset=end
    }
  }
  async ticket(userId, profile = {}) {
    const token=crypto.randomUUID()+crypto.randomUUID()
    this.sql.exec('DELETE FROM tickets WHERE expires<?',Date.now())
    this.sql.exec('INSERT INTO tickets VALUES (?,?,?)',await hash(new TextEncoder().encode(token)),JSON.stringify({id:userId,...profile}),Date.now()+60000)
    return token
  }
  async uploadTicket(userId, fingerprint, size, mime) {
    const token=crypto.randomUUID()+crypto.randomUUID()
    this.sql.exec('DELETE FROM upload_tickets WHERE expires<?',Date.now())
    this.sql.exec('INSERT INTO upload_tickets VALUES (?,?,?)',await hash(new TextEncoder().encode(token)),JSON.stringify({userId,fingerprint,size,mime}),Date.now()+5*60*1000)
    return token
  }
  async receiveUpload(sphereId, fingerprint, request) {
    // Finish the incoming RPC stream before returning an early rejection. Leaving
    // it unread disconnects large HTTP uploads before their 403 reaches the client.
    const reject=async error=>{
      const reader=request.body?.getReader()
      if(reader)while(!(await reader.read()).done){}
      return json({error},403)
    }
    if(request.headers.get('Origin')!==this.env.CURSADO_ORIGIN)return reject('Origen no permitido.')
    const token=new URL(request.url).searchParams.get('ticket') || ''
    const tokenHash=await hash(new TextEncoder().encode(token))
    const row=this.sql.exec('SELECT value FROM upload_tickets WHERE hash=? AND expires>?',tokenHash,Date.now()).toArray()[0]
    if(!row)return reject('La autorización de subida venció o ya se utilizó.')
    const ticket=JSON.parse(row.value)
    if(ticket.fingerprint!==fingerprint || request.headers.get('content-type')!==ticket.mime)return reject('Archivo no autorizado.')
    this.sql.exec('DELETE FROM upload_tickets WHERE hash=?',tokenHash)
    const result=await this.upload(sphereId,request,fingerprint,ticket.mime,ticket.size)
    return json(result,result.status || 200)
  }
  async fetch(request) {
    if(this.cancelled())return json({detail:'Esta cooperación fue deshecha.'},403)
    const url=new URL(request.url), token=url.searchParams.get('ticket') || ''
    const ticketHash=await hash(new TextEncoder().encode(token))
    const ticket=this.sql.exec('SELECT * FROM tickets WHERE hash=? AND expires>?',ticketHash,Date.now()).toArray()[0]
    if(!ticket || request.headers.get('Upgrade')?.toLowerCase()!=='websocket' || request.headers.get('Origin')!==this.env.CURSADO_ORIGIN)return json({detail:'Acceso a sala no permitido.'},403)
    this.sql.exec('DELETE FROM tickets WHERE hash=?',ticketHash)
    const pair=new WebSocketPair(), [client,server]=Object.values(pair)
    this.ctx.acceptWebSocket(server)
    const profile=JSON.parse(ticket.user_id)
    server.serializeAttachment({userId:profile.id,name:profile.name,color:profile.color,emoji:profile.emoji,clientId:crypto.randomUUID()})
    server.send(JSON.stringify({type:'changed',seq:this.read().seq}))
    this.presence()
    return new Response(null,{status:101,webSocket:client})
  }
  presence() {
    const sockets=this.ctx.getWebSockets(),users=new Map()
    for(const socket of sockets){const p=socket.deserializeAttachment();if(!p)continue;const user=users.get(p.userId)||{id:p.userId,name:p.name,color:p.color,emoji:p.emoji,client_ids:[]};user.client_ids.push(p.clientId);users.set(p.userId,user)}
    for(const socket of sockets)try{socket.send(JSON.stringify({type:'presence',users:[...users.values()],you:socket.deserializeAttachment()?.userId}))}catch{}
  }
  broadcast(value) {for(const socket of this.ctx.getWebSockets())try{socket.send(JSON.stringify(value))}catch{}}
  notifyDirectory() {
    const state=this.read();state.seq++;this.write(state)
    this.broadcast({type:'directory_changed',seq:state.seq})
  }
  webSocketMessage(socket, raw) {
    if(this.cancelled())return
    if(typeof raw!=='string' || raw.length>8192)return
    try {
      const value=JSON.parse(raw)
      if(value.type==='presence')this.presence()
      if(value.type==='editor' && typeof value.document==='string' && /^[a-zA-Z0-9-]{1,120}$/.test(value.document) && ['cursor_move','cursor_hide','stroke_start','stroke_points','stroke_end','stroke_cancel','camera_move','video_state'].includes(value.payload?.type)) {
        const p=socket.deserializeAttachment()
        const message={type:'editor',document:value.document,payload:{...value.payload,user_id:p.userId,client_id:p.clientId,name:p.name,color:value.payload.color || p.color,emoji:p.emoji}}
        for(const other of this.ctx.getWebSockets())if(other!==socket)try{other.send(JSON.stringify(message))}catch{}
      }
    }catch{}
  }
  webSocketClose(socket, code) {
    // Abnormal disconnects report reserved codes that cannot be sent on the wire.
    const replyCode=code>=1000 && code<=4999 && ![1004,1005,1006,1015].includes(code)?code:1000
    try{socket.close(replyCode)}catch{}this.presence()
  }
  webSocketError(socket) {socket.close(1011,'Reconectar');this.presence()}
  snapshot() {return this.read()}
  snapshotResponse() {return json(this.read())}
  summary() {const state=this.read();return {deleted:!!state.resources['sphere.json']?.deleted,ready:!!state.resources['sphere.json']&&!state.resources['sphere.json'].deleted,name:state.resources['sphere.json']?.value?.name,color:state.resources['sphere.json']?.value?.color,bytes:Object.values(state.resources).filter(r=>!r.deleted).reduce((total,r)=>total+(r.blob?.size || new TextEncoder().encode(JSON.stringify(r.value)).length),0)}}
  async upload(sphereId, request, expected, mime, expectedSize) {
    if(!/^[a-f0-9]{64}$/.test(expected))return {error:'Archivo inválido.',status:422}
    const key=`${this.env.CONTENT_PREFIX}${sphereId}/${expected}`
    const upload=await this.env.CONTENT_FILES.createMultipartUpload(key,{httpMetadata:{contentType:mime || 'application/octet-stream'}})
    const reader=request.body?.getReader(), digest=new Sha256(), parts=[], chunks=[]
    let size=0, buffered=0
    const flush=async()=>{
      const bytes=new Uint8Array(buffered);let offset=0
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
      parts.push(await upload.uploadPart(parts.length+1,bytes));chunks.length=0;buffered=0
    }
    try {
      if(reader)while(true){
        const part=await reader.read();if(part.done)break
        size+=part.value.byteLength
        if(size>100*1024*1024){await reader.cancel();await upload.abort();return {error:'El archivo supera 100 MB.',status:413}}
        if(expectedSize!==undefined && size>expectedSize){await reader.cancel();await upload.abort();return {error:'El tamaño del archivo no coincide.',status:422}}
        digest.update(part.value);chunks.push(part.value);buffered+=part.value.byteLength
        if(buffered>=8*1024*1024)await flush()
      }
      const actual=[...await digest.digest()].map(x=>x.toString(16).padStart(2,'0')).join('')
      if(actual!==expected || (expectedSize!==undefined && size!==expectedSize)){await upload.abort();return {error:'El archivo no pasó la verificación.',status:422}}
      if(buffered)await flush()
      if(!parts.length){await upload.abort();await this.env.CONTENT_FILES.put(key,new Uint8Array(),{httpMetadata:{contentType:mime || 'application/octet-stream'}})}
      else await upload.complete(parts)
      return {ok:true}
    } catch(error) {await upload.abort().catch(()=>{});throw error}
  }
  async file(sphereId, fingerprint) {
    const state=this.read()
    if(!Object.values(state.resources).some(r=>r.blob?.hash===fingerprint) && !state.conflicts.some(c=>c.blob?.hash===fingerprint))return null
    const file=await this.env.CONTENT_FILES.get(`${this.env.CONTENT_PREFIX}${sphereId}/${fingerprint}`)
    return file ? new Response(file.body,{headers:{'Cache-Control':'private, no-store','Content-Type':file.httpMetadata?.contentType || 'application/octet-stream'}}) : null
  }
  async commit(sphereId, userId, operation) {
    if(this.cancelled())return {error:'Esta cooperación fue deshecha.',status:403}
    if(!operation || !/^[a-zA-Z0-9-]{1,100}$/.test(operation.id) || !Array.isArray(operation.changes) || operation.changes.length>500)return {error:'Operación inválida.',status:422}
    const prior=this.sql.exec('SELECT seq FROM operations WHERE id=?',`${userId}:${operation.id}`).toArray()[0]
    if(prior)return {seq:prior.seq}
    for(const change of operation.changes) {
      if(!safeCooperationPath(change.key) || !['json','blob','delete'].includes(change.type))return {error:'Recurso inválido.',status:422}
      for(const field of ['value','base']) {
        const pointer=change[`${field}File`]
        if(!pointer)continue
        if(change.type!=='json' || !/^[a-f0-9]{64}$/.test(pointer.hash || '') || !Number.isSafeInteger(pointer.size))return {error:'Documento inválido.',status:422}
        const file=await this.env.CONTENT_FILES.get(`${this.env.CONTENT_PREFIX}${sphereId}/${pointer.hash}`)
        if(!file || file.size!==pointer.size)return {error:'Primero subí el documento completo.',status:409}
        try {change[field]=await new Response(file.body).json()}catch{return {error:'Documento JSON inválido.',status:422}}
        delete change[`${field}File`]
      }
      if(change.type==='json' && change.value===undefined)return {error:'Falta el contenido del recurso.',status:422}
      if(change.type==='blob') {
        if(!/^[a-f0-9]{64}$/.test(change.blob?.hash || ''))return {error:'Archivo inválido.',status:422}
        const stored=await this.env.CONTENT_FILES.head(`${this.env.CONTENT_PREFIX}${sphereId}/${change.blob.hash}`)
        if(!stored || stored.size!==change.blob.size)return {error:'Primero subí y verificá el archivo.',status:409}
      }
    }
    // No awaits between reading the latest state and committing it.
    if(this.cancelled())return {error:'Esta cooperación fue deshecha.',status:403}
    const duplicate=this.sql.exec('SELECT seq FROM operations WHERE id=?',`${userId}:${operation.id}`).toArray()[0]
    if(duplicate)return {seq:duplicate.seq}
    const state=this.read(), seq=state.seq+1
    for(const change of operation.changes) {
      const previous=state.resources[change.key]
      if(previous?.deleted)continue
      if(change.type==='delete') {
        if(previous)state.resources[change.key]={...previous,deleted:true,seq,author:userId}
        continue
      }
      let resource={...change,seq,author:userId}
      delete resource.base
      if(change.type==='json') {
        const conflicts=[]
        resource.value=mergeCooperation(change.base,change.value,previous?.value,conflicts)
        if(!previous)resource.value=change.value
        if(conflicts.length)state.conflicts.push({key:change.key,seq,author:userId,conflicts})
      } else if(previous && change.baseHash!==previous.blob?.hash && previous.blob?.hash!==change.blob.hash) {
        state.conflicts.push({key:change.key,seq,author:userId,blob:previous.blob})
      }
      state.resources[change.key]=resource
    }
    state.seq=seq
    this.ctx.storage.transactionSync(()=>{
      this.write(state)
      this.sql.exec('INSERT INTO operations VALUES (?,?,?)',`${userId}:${operation.id}`,seq,JSON.stringify({userId,keys:operation.changes.map(change=>change.key)}))
    })
    this.broadcast({type:'changed',seq})
    return {seq}
  }
}
