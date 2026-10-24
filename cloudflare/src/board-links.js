import { DurableObject } from 'cloudflare:workers'
import { reachableBoards, boardTargets, validBoardContent } from '../../lib/board-link-model.ts'

const json = (value, status=200, headers={}) => Response.json(value,{status,headers:{'Cache-Control':'private, no-store',...headers}})
const random = () => crypto.randomUUID()+crypto.randomUUID()
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')
const animals = ['Zorro','Panda','Búho','Delfín','Gato','Colibrí','Nutria','Tigre','Koala','Pingüino']
const cookieName = 'pizarra_link_sid'
const fail = (status,message) => {throw Object.assign(new Error(message),{status})}
const fileKey = (env,id) => `${env.CONTENT_PREFIX}board-links/${id}`

/** One directory serializes graph changes and permission checks, including socket revocation. */
export class BoardLinks extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env)
    this.sql=ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  }
  read(key) {const rows=this.sql.exec('SELECT value FROM entries WHERE key=?',key).toArray();return rows.length?JSON.parse(rows[0].value):null}
  write(key,value) {
    // Scene documents are chunked to stay below SQLite's per-row limit.
    if(key.startsWith('scene:')) {
      const text=JSON.stringify(value), prior=this.read(`parts:${key}`)||0
      let offset=0,part=0
      while(offset<text.length){let end=Math.min(offset+32000,text.length);if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]))end--;this.write(`${key.replace('scene:','chunk:')}:${part++}`,text.slice(offset,end));offset=end}
      for(let i=part;i<prior;i++)this.sql.exec('DELETE FROM entries WHERE key=?',`${key.replace('scene:','chunk:')}:${i}`)
      this.write(`parts:${key}`,part);return
    }
    this.sql.exec('INSERT INTO entries VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value))
  }
  scene(id) {const n=this.read(`parts:scene:${id}`)||0;return n?JSON.parse(Array.from({length:n},(_,i)=>this.read(`chunk:${id}:${i}`)).join('')):null}
  closure(root) {return reachableBoards(root,id=>this.read(`board:${id}`)?.targets || [])}
  actor(request) {const value=request.headers.get('X-Board-Link-Identity');return value?JSON.parse(decodeURIComponent(value)):null}
  session(request) {
    const token=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1)
    return token ? this.read(`session:${token}`) : null
  }
  principal(request) {const actor=this.actor(request),session=this.session(request);return actor?{...actor,aliases:session?[session.id]:[]}:session}
  owns(principal,owner){return principal.id===owner || principal.aliases?.includes(owner)}
  authorize(principal,boardId,token) {
    const board=this.read(`board:${boardId}`)
    if(!board || !principal)fail(403,'No tenés acceso a esta pizarra.')
    if(this.owns(principal,board.owner))return board
    const link=this.read(`link:${token}`)
    if(!link?.active || !this.closure(link.root).has(boardId))fail(403,'El enlace fue desactivado o esta pizarra ya no está compartida.')
    return board
  }
  sockets() {return this.ctx.getWebSockets()}
  refreshSockets() {
    for(const socket of this.sockets()) {
      const attachment=socket.deserializeAttachment()
      try {this.authorize(attachment.principal,attachment.boardId,attachment.link)}
      catch {socket.close(4003,'Acceso desactivado')}
    }
    this.presence()
  }
  presence() {
    for(const socket of this.sockets()) {
      const a=socket.deserializeAttachment(), users=new Map()
      for(const other of this.sockets()){const p=other.deserializeAttachment();if(p.boardId!==a.boardId)continue;const user=users.get(p.principal.id)||{id:p.principal.id,name:p.principal.name,color:p.principal.color,emoji:p.principal.emoji,client_ids:[]};user.client_ids.push(p.clientId);users.set(user.id,user)}
      try{socket.send(JSON.stringify({type:'presence',board_id:a.boardId,you:a.principal.id,users:[...users.values()]}))}catch{}
    }
  }
  notify(boardId,version) {for(const socket of this.sockets())if(socket.deserializeAttachment().boardId===boardId)try{socket.send(JSON.stringify({type:'board_version',board_id:boardId,version}))}catch{}}
  async fetch(request) {
    try {return await this.handle(request)}catch(error){
      // Complete an incoming RPC stream before an early rejection. Otherwise
      // workerd can disconnect the caller before it receives the error response.
      if(request.body&&!request.bodyUsed)try{const reader=request.body.getReader();while(!(await reader.read()).done){}}catch{}
      return json({detail:error instanceof SyntaxError?'Datos JSON inválidos.':error.status?error.message:'No se pudo completar la operación de compartir.'},error instanceof SyntaxError?422:error.status||500)
    }
  }
  async handle(request) {
    const url=new URL(request.url), parts=url.pathname.split('/').filter(Boolean).slice(2), method=request.method
    if(parts[0]==='socket') {
      const ticketHash=await hash(url.searchParams.get('ticket')||''), ticket=this.read(`ticket:${ticketHash}`)
      if(!ticket || ticket.expires<Date.now() || request.headers.get('Origin')!==this.env.CURSADO_ORIGIN || request.headers.get('Upgrade')?.toLowerCase()!=='websocket')fail(403,'Conexión no autorizada.')
      this.sql.exec('DELETE FROM entries WHERE key=?',`ticket:${ticketHash}`)
      this.authorize(ticket.principal,ticket.boardId,ticket.link)
      const [client,server]=Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server);server.serializeAttachment({...ticket,clientId:crypto.randomUUID()})
      this.presence();return new Response(null,{status:101,webSocket:client})
    }
    if(parts[0]==='upload') {
      const ticketHash=await hash(url.searchParams.get('ticket')||''), ticket=this.read(`upload:${ticketHash}`)
      if(method!=='PUT' || !ticket || ticket.expires<Date.now())fail(403,'La autorización de subida venció.')
      this.authorize(ticket.principal,ticket.boardId,ticket.link)
      if(request.headers.get('Content-Type')!==ticket.mime)fail(422,'Tipo de archivo incorrecto.')
      this.sql.exec('DELETE FROM entries WHERE key=?',`upload:${ticketHash}`)
      const result=await this.env.CONTENT_ROOMS.getByName('board-link-uploads').upload('board-links',request,ticket.hash,ticket.mime,ticket.size)
      if(result.error)return json(result,result.status||422)
      this.write(`receipt:${ticket.principal.id}:${ticket.hash}`,true)
      return json({ok:true})
    }
    // Routes such as session and ticket only need headers, but their JSON body
    // still has to finish crossing the Durable Object RPC boundary.
    const raw=request.body?await request.text():''
    const payload=raw?JSON.parse(raw):{}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))fail(422,'Datos inválidos.')
    if(parts[0]==='session' && method==='POST') {
      let principal=this.principal(request), cookie
      if(!principal){const token=random();principal={id:`guest:${crypto.randomUUID()}`,name:`${animals[crypto.getRandomValues(new Uint8Array(1))[0]%animals.length]} ${crypto.randomUUID().slice(0,4)}`,color:'#6366f1',emoji:'🐾'};this.write(`session:${token}`,principal);cookie=`${cookieName}=${token}; Path=/pizarra/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`}
      return json(principal,200,cookie?{'Set-Cookie':cookie}:{})
    }
    const principal=this.principal(request)
    if(!principal)fail(401,'No se pudo iniciar la sesión de colaboración.')
    const token=url.searchParams.get('link')||''
    if(parts[0]==='open' && method==='GET') {
      const link=this.read(`link:${token}`)
      if(!link?.active)fail(403,'Este enlace fue desactivado o no existe.')
      return json({root:link.root,boards:[...this.closure(link.root)].map(id=>({id,name:this.read(`board:${id}`)?.name||'Pizarra'})),profile:principal})
    }
    if(parts[0]==='boards' && parts.length===1 && method==='POST') {
      const body=payload
      if(typeof body.source!=='string'||body.source.length>300 || typeof body.name!=='string'||body.name.length>500)fail(422,'Pizarra inválida.')
      const sourceKey=`source:${principal.id}:${body.source}`, existing=this.read(sourceKey)
      if(existing)return json({id:existing})
      const id=crypto.randomUUID();this.write(`board:${id}`,{id,owner:principal.id,name:body.name,version:0,targets:[],files:{}});this.write(sourceKey,id)
      return json({id},201)
    }
    if(parts[0]!=='boards' || !/^[a-f0-9-]{36}$/.test(parts[1]||''))fail(404,'Ruta no encontrada.')
    const id=parts[1], board=this.authorize(principal,id,token), owner=this.owns(principal,board.owner)
    if(parts[2]==='link') {
      if(!owner)fail(403,'Solo el creador puede administrar el enlace.')
      let current=this.read(`board-link:${id}`)
      if(method==='DELETE'){if(current)this.write(`link:${current}`,{root:id,active:false});this.write(`board-link:${id}`,null);this.refreshSockets();return json({ok:true})}
      if(method==='POST'){if([...this.closure(id)].some(target=>!this.read(`board:${target}`)?.version))fail(409,'Primero guardá el contenido completo de las pizarras vinculadas.');if(!current){current=random();this.write(`link:${current}`,{root:id,active:true});this.write(`board-link:${id}`,current)}return json({token:current})}
      if(method==='GET')return json({token:current})
    }
    if(parts[2]==='ticket' && method==='POST') {
      this.sql.exec("DELETE FROM entries WHERE (key LIKE 'ticket:%' OR key LIKE 'upload:%') AND json_extract(value,'$.expires')<?",Date.now())
      const ticket=random(), key=await hash(ticket)
      // Recheck permissions after hashing, which yields to other requests.
      this.authorize(principal,id,token)
      this.write(`ticket:${key}`,{principal,boardId:id,link:token,expires:Date.now()+60000})
      const socket=new URL('/api/board-links/socket',request.url);socket.protocol='wss:';socket.searchParams.set('ticket',ticket)
      return json({url:socket.href})
    }
    if(parts[2]==='files' && method==='POST') {
      const body=payload
      if(!/^[a-f0-9]{64}$/.test(body.hash||'') || !Number.isSafeInteger(body.size)||body.size<1||body.size>100*1024*1024||typeof body.mime!=='string'||body.mime.length>200||/[\r\n]/.test(body.mime))fail(422,'Archivo inválido (máximo 100 MB).')
      const upload=random(), key=await hash(upload)
      this.authorize(principal,id,token)
      this.write(`upload:${key}`,{...body,boardId:id,principal,link:token,expires:Date.now()+300000})
      const uploadUrl=new URL('/api/board-links/upload',request.url);uploadUrl.searchParams.set('ticket',upload)
      return json({uploadUrl:uploadUrl.href})
    }
    if(parts[2]==='files' && method==='GET') {
      const resourceId=decodeURIComponent(parts[3]||''),file=board.files[resourceId]
      if(!file)fail(404,'Este archivo no está compartido.')
      const stored=await this.env.CONTENT_FILES.get(fileKey(this.env,file.hash))
      const current=this.authorize(principal,id,token)
      if(current.files[resourceId]?.hash!==file.hash)fail(403,'Este archivo ya no está compartido.')
      if(!stored)fail(404,'El archivo no está disponible.')
      return new Response(stored.body,{headers:{'Content-Type':file.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}})
    }
    if(parts.length===2 && method==='GET')return json({...board,content:this.scene(id)})
    if(parts.length===2 && method==='PUT') {
      const body=payload
      if(!validBoardContent(body.content) || !Number.isSafeInteger(body.version))fail(422,'Documento inválido.')
      const files=body.files||{}
      if(!files || Array.isArray(files)||typeof files!=='object'||Object.keys(files).length>5000)fail(422,'Archivos inválidos.')
      for(const [key,file] of Object.entries(files)) {
        if(!/^[a-zA-Z0-9_:.\-]{1,200}$/.test(key)||!file||!/^[a-f0-9]{64}$/.test(file.hash||'')||typeof file.mime!=='string'||!(/^(application\/(pdf|octet-stream)|image\/(png|jpeg|webp|svg\+xml)|audio\/(webm|ogg|mp4|mpeg|wav))(;codecs=[a-z0-9, -]+)?$/i.test(file.mime))||typeof file.name!=='string'||file.name.length>500)fail(422,'Archivo inválido.')
        if(board.files[key]?.hash!==file.hash && !this.read(`receipt:${principal.id}:${file.hash}`))fail(403,'El archivo no fue publicado por esta sesión.')
      }
      const latest=this.authorize(principal,id,token)
      if(latest.version!==body.version)fail(409,'La pizarra cambió. Reintentá la sincronización.')
      // Guests can only add shortcuts to boards already in their authorized closure.
      const targets=boardTargets(body.content), allowed=owner?null:this.closure(this.read(`link:${token}`).root)
      for(const target of targets){const destination=this.read(`board:${target}`);if(!destination || (owner?!this.owns(principal,destination.owner):!allowed.has(target)))fail(403,'El acceso directo apunta a una pizarra sin permiso para compartir.')}
      for(const media of body.content.media)if(!files[media.assetId])fail(422,'Falta una imagen o audio de la pizarra.')
      for(const shape of body.content.shapes||[])if(shape.visualType==='pdf-shortcut'&&!files[shape.pdfReference?.sharedFileId])fail(422,'Falta un PDF vinculado.')
      // No awaits between final authorization, scene write and graph update.
      const updated={...latest,version:latest.version+1,targets,files}
      this.ctx.storage.transactionSync(()=>{this.write(`scene:${id}`,body.content);this.write(`board:${id}`,updated)})
      this.refreshSockets();this.notify(id,updated.version)
      return json({version:updated.version,content:body.content})
    }
    fail(405,'Método no permitido.')
  }
  webSocketMessage(socket,raw) {
    const a=socket.deserializeAttachment()
    try {
      this.authorize(a.principal,a.boardId,a.link)
      if(typeof raw!=='string'||raw.length>8192)return
      const message=JSON.parse(raw)
      if(!['cursor_move','cursor_hide','stroke_start','stroke_points','stroke_end','stroke_cancel','camera_move','video_state'].includes(message.type))return
      const value={...message,board_id:a.boardId,user_id:a.principal.id,client_id:a.clientId,name:a.principal.name,emoji:a.principal.emoji}
      for(const other of this.sockets())if(other!==socket&&other.deserializeAttachment().boardId===a.boardId)try{other.send(JSON.stringify(value))}catch{}
    } catch {socket.close(4003,'Acceso desactivado')}
  }
  webSocketClose(socket,code){try{socket.close(code>=1000&&code<=4999&&![1004,1005,1006,1015].includes(code)?code:1000)}catch{}this.presence()}
  webSocketError(socket){socket.close(1011,'Reconectar');this.presence()}
}

export async function boardLinksRequest(directory,request) {
  let user=null
  try {user=(await directory.authenticated(request)).user}catch(error){if(error.status!==401)throw error}
  const headers=new Headers(request.headers);headers.delete('X-Board-Link-Identity')
  if(user)headers.set('X-Board-Link-Identity',encodeURIComponent(JSON.stringify({id:user.id,name:user.display_name,color:user.color,emoji:user.emoji})))
  return directory.env.BOARD_LINKS.getByName('board-links-v1').fetch(new Request(request,{headers}))
}
