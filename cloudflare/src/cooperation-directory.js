import { parseCooperationNames } from '../../lib/cooperation-model.ts'

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
async function notifyUsers(env, ids) {
  await Promise.allSettled([...new Set(ids)].map(id=>env.CONTENT_ROOMS.getByName(`notifications:${id}`).notifyDirectory()))
}
export function initializeCooperation(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS cooperation_groups (id TEXT PRIMARY KEY, members TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL)')
  sql.exec('CREATE TABLE IF NOT EXISTS cooperation_members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(group_id,user_id))')
  sql.exec('CREATE TABLE IF NOT EXISTS cooperation_spheres (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, created_by TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0)')
  sql.exec('CREATE TABLE IF NOT EXISTS cooperation_sphere_groups (sphere_id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY(sphere_id,group_id))')
  if(!sql.exec('PRAGMA table_info(cooperation_spheres)').toArray().some(column=>column.name==='kind'))sql.exec("ALTER TABLE cooperation_spheres ADD COLUMN kind TEXT NOT NULL DEFAULT 'subject'")
  sql.exec('INSERT OR IGNORE INTO cooperation_sphere_groups SELECT id,group_id FROM cooperation_spheres')
}
export async function cooperationRequest(directory,request) {
  const {user}=await directory.authenticated(request), sql=directory.sql, env=directory.env
  const url=new URL(request.url), parts=url.pathname.replace(/\/+$/, '').slice('/api/cooperation/'.length).split('/')
  if(parts[0]==='groups' && parts.length===3 && parts[2]==='accept' && request.method==='POST') {
    await request.arrayBuffer()
    const membership=directory.first('SELECT accepted FROM cooperation_members WHERE group_id=? AND user_id=?',parts[1],user.id)
    if(!membership)return json({detail:'No tenés una invitación a este grupo.'},403)
    if(!membership.accepted){
      sql.exec('UPDATE cooperation_members SET accepted=1 WHERE group_id=? AND user_id=?',parts[1],user.id)
      await notifyUsers(env,sql.exec('SELECT user_id FROM cooperation_members WHERE group_id=?',parts[1]).toArray().map(member=>member.user_id))
    }
    return json({ok:true})
  }
  if(parts[0]==='notifications' && parts[1]==='ticket' && request.method==='POST') {
    const token=await env.CONTENT_ROOMS.getByName(`notifications:${user.id}`).ticket(user.id)
    const socket=new URL(`/api/cooperation/notifications/socket/${user.id}`,request.url)
    socket.protocol='wss:';socket.searchParams.set('ticket',token)
    return json({url:socket.href})
  }
  if(parts[0]==='groups' && parts.length===1) {
    if(request.method==='GET') {
      const groups=await Promise.all(sql.exec(`SELECT g.*,m.accepted FROM cooperation_groups g JOIN cooperation_members m ON m.group_id=g.id WHERE m.user_id=?`,user.id).toArray().map(async group=>({
        id:group.id,accepted:!!group.accepted,
        members:sql.exec('SELECT u.id,u.display_name FROM users u JOIN cooperation_members m ON m.user_id=u.id WHERE m.group_id=?',group.id).toArray(),
        spheres:(await Promise.all(sql.exec('SELECT s.*,sg.group_id FROM cooperation_spheres s JOIN cooperation_sphere_groups sg ON sg.sphere_id=s.id WHERE sg.group_id=?',group.id).toArray().map(async sphere=>{
          // Zero bytes can mean either a new publication or a deleted sphere.
          if(!sphere.bytes && (await env.CONTENT_ROOMS.getByName(sphere.id).summary()).deleted)return null
          return {...sphere,ready:sphere.bytes>0}
        }))).filter(Boolean),
      })))
      for(const group of groups){group.importantShares=group.spheres.filter(s=>s.kind==='important');group.spheres=group.spheres.filter(s=>s.kind!=='important')}
      return json({user:{id:user.id,name:user.display_name},groups})
    }
    if(request.method!=='POST')return json({detail:'Método no permitido.'},405)
    const body=await request.json()
    let names
    try { names=parseCooperationNames(body.names) } catch(error) { return json({detail:error.message},422) }
    const users=[user]
    for(const name of names) {
      const normalized=name.normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ').replace(/\s+/gu,' ').trim()
      const found=directory.first('SELECT * FROM users WHERE login_name=?',normalized)
      if(!found)return json({detail:`No existe el usuario «${name}».`},422)
      if(users.some(u=>u.id===found.id))return json({detail:'No incluyas tu usuario ni nombres repetidos.'},422)
      users.push(found)
    }
    const members=JSON.stringify(users.map(u=>u.id).sort()), existing=directory.first('SELECT id FROM cooperation_groups WHERE members=?',members)
    if(existing)return json({id:existing.id})
    const id=crypto.randomUUID()
    directory.ctx.storage.transactionSync(()=>{
      sql.exec('INSERT INTO cooperation_groups VALUES (?,?,?,?)',id,members,user.id,new Date().toISOString())
      for(const member of users)sql.exec('INSERT INTO cooperation_members VALUES (?,?,?)',id,member.id,member.id===user.id?1:0)
    })
    await notifyUsers(env,users.map(member=>member.id))
    return json({id},201)
  }
  if(parts[0]==='spheres' && parts.length===1 && request.method==='POST') {
    const body=await request.json(), membership=directory.first('SELECT accepted FROM cooperation_members WHERE group_id=? AND user_id=?',body.groupId,user.id)
    if(!membership?.accepted)return json({detail:'Aceptá el grupo antes de compartir.'},403)
    if(typeof body.name!=='string' || !body.name.trim() || body.name.length>150 || !/^#[a-fA-F0-9]{6}$/.test(body.color || ''))return json({detail:'Esfera inválida.'},422)
    if(body.sphereId) {
      const source=directory.first('SELECT s.id FROM cooperation_spheres s JOIN cooperation_sphere_groups sg ON sg.sphere_id=s.id JOIN cooperation_members m ON m.group_id=sg.group_id WHERE s.id=? AND m.user_id=? AND m.accepted=1',body.sphereId,user.id)
      if(!source)return json({detail:'No ten\u00e9s acceso a esta esfera.'},403)
      sql.exec('INSERT OR IGNORE INTO cooperation_sphere_groups VALUES (?,?)',source.id,body.groupId)
      await notifyUsers(env,sql.exec('SELECT user_id FROM cooperation_members WHERE group_id=?',body.groupId).toArray().map(member=>member.user_id))
      return json({id:source.id})
    }
    const id=crypto.randomUUID()
    sql.exec('INSERT INTO cooperation_spheres(id,group_id,name,color,created_by,kind) VALUES (?,?,?,?,?,?)',id,body.groupId,body.name,body.color,user.id,body.kind==='important'?'important':'subject')
    sql.exec('INSERT INTO cooperation_sphere_groups VALUES (?,?)',id,body.groupId)
    await notifyUsers(env,sql.exec('SELECT user_id FROM cooperation_members WHERE group_id=?',body.groupId).toArray().map(member=>member.user_id))
    return json({id},201)
  }
  if(parts[0]!=='spheres' || !/^[a-f0-9-]{36}$/.test(parts[1] || ''))return json({detail:'Ruta no encontrada.'},404)
  const sphere=directory.first('SELECT * FROM cooperation_spheres WHERE id=?',parts[1])
  const sphereUsers=()=>sql.exec('SELECT DISTINCT m.user_id FROM cooperation_members m JOIN cooperation_sphere_groups sg ON sg.group_id=m.group_id WHERE sg.sphere_id=?',sphere.id).toArray().map(member=>member.user_id)
  if(parts.length===3 && parts[2]==='undo' && request.method==='POST') {
    const body=await request.json().catch(()=>({}))
    if(body.expectedSeq!==undefined && (!Number.isSafeInteger(body.expectedSeq) || body.expectedSeq<0))return json({detail:'Versión inválida.'},422)
    if(!sphere)return json({ok:true})
    if(sphere.created_by!==user.id)return json({detail:'Solo quien compartió la esfera puede deshacer la cooperación.'},403)
    const result=await env.CONTENT_ROOMS.getByName(sphere.id).cancelPublication(user.id,body.expectedSeq)
    if(result.error)return json({detail:result.error},result.status)
    const recipients=sphereUsers()
    sql.exec('DELETE FROM cooperation_sphere_groups WHERE sphere_id=?',sphere.id)
    sql.exec('DELETE FROM cooperation_spheres WHERE id=?',sphere.id)
    await notifyUsers(env,recipients)
    return json({ok:true})
  }
  const member=sphere && directory.first('SELECT m.accepted,m.group_id FROM cooperation_members m JOIN cooperation_sphere_groups sg ON sg.group_id=m.group_id WHERE sg.sphere_id=? AND m.user_id=? ORDER BY m.accepted DESC LIMIT 1',sphere.id,user.id)
  if(!member)return json({detail:'No tenés acceso a esta esfera.'},403)
  const room=env.CONTENT_ROOMS.getByName(sphere.id)
  if(parts[2]==='accept' && request.method==='POST') {
    sql.exec('UPDATE cooperation_members SET accepted=1 WHERE group_id=? AND user_id=?',member.group_id,user.id)
    await notifyUsers(env,[user.id])
    return json({ok:true})
  }
  if(!member.accepted)return json({detail:'Aceptá la invitación antes de descargar contenido.'},403)
  if(parts[2]==='snapshot' && request.method==='GET')return room.snapshotResponse()
  if(parts[2]==='ticket' && request.method==='POST') {
    const token=await room.ticket(user.id,{name:user.display_name,color:user.color,emoji:user.emoji})
    const socket=new URL(`/api/cooperation/socket/${sphere.id}`,request.url);socket.protocol='wss:';socket.searchParams.set('ticket',token)
    return json({url:socket.href})
  }
  if(parts[2]==='operations' && request.method==='POST') {
    const result=await room.commit(sphere.id,user.id,await request.json())
    if(!result.error) {
      const {bytes,name,color,ready}=await room.summary()
      sql.exec('UPDATE cooperation_spheres SET bytes=?,name=?,color=? WHERE id=?',ready?bytes:0,typeof name==='string'&&name.length<=150?name:sphere.name,/^#[a-fA-F0-9]{6}$/.test(color || '')?color:sphere.color,sphere.id)
      if(Boolean(sphere.bytes)!==ready || typeof name==='string' && name!==sphere.name || typeof color==='string' && color!==sphere.color)await notifyUsers(env,sphereUsers())
    }
    return json(result,result.status || 200)
  }
  if(parts[2]==='files' && /^[a-f0-9]{64}$/.test(parts[3] || '')) {
    if(request.method==='POST') {
      const {size,mime='application/octet-stream'}=await request.json()
      if(!Number.isSafeInteger(size) || size<0 || size>100*1024*1024 || typeof mime!=='string' || !mime.trim() || mime.length>200 || /[\r\n]/.test(mime))return json({detail:'Archivo inválido.'},422)
      const objectKey=`${env.CONTENT_PREFIX}${sphere.id}/${parts[3]}`
      const existing=await env.CONTENT_FILES.head(objectKey)
      if(existing?.size===size)return json({objectKey,bucket:'estudiodiario',exists:true})
      const ticket=await room.uploadTicket(user.id,parts[3],size,mime)
      const uploadUrl=new URL(`/api/cooperation/upload/${sphere.id}/${parts[3]}`,request.url)
      uploadUrl.searchParams.set('ticket',ticket)
      return json({objectKey,bucket:'estudiodiario',exists:false,uploadUrl:uploadUrl.href,headers:{'Content-Type':mime}})
    }
    if(request.method==='PUT') {
      const result=await room.upload(sphere.id,request,parts[3],request.headers.get('content-type'))
      return json(result,result.status || 200)
    }
    if(request.method==='GET') {
      const file=await room.file(sphere.id,parts[3])
      return file || json({detail:'Archivo no encontrado.'},404)
    }
  }
  return json({detail:'Método o ruta no permitido.'},405)
}
