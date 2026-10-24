import { build } from 'esbuild'
import { DatabaseSync } from 'node:sqlite'

const bundle = await build({ entryPoints: ['cloudflare/src/index.js'], bundle:true, write:false, format:'esm', platform:'browser',
  plugins:[{name:'cloudflare-test-runtime',setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'fixture'}))
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}'}))
  }}],
})
const {default:worker,IdentityDirectory,SharedContentRoom,BoardLinks} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

export function authRuntime(origin = 'https://cursado.vercel.app') {
  const db = new DatabaseSync(':memory:')
  const ctx = { storage: {
    sql: { exec(query,...args) {
      const statement=db.prepare(query), rows=statement.columns().length ? statement.all(...args) : (statement.run(...args),[])
      return { toArray:()=>rows, one:()=>{if(rows.length!==1)throw new Error('Expected one row');return rows[0]} }
    } },
    transactionSync(callback) {db.exec('BEGIN');try{const result=callback();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}},
  } }
  const env = {CURSADO_ORIGIN:origin,AUTH_PEPPER:'test-only-private-pepper-with-more-than-32-characters'}
  const rooms=new Map(), objects=new Map()
  env.CONTENT_PREFIX='cursado/shared/'
  env.CONTENT_FILES={
    async createMultipartUpload(key,options){const chunks=new Map();return {async uploadPart(number,bytes){chunks.set(number,new Uint8Array(bytes));return {partNumber:number,etag:String(number)}},async complete(parts){const bytes=new Uint8Array([...chunks.values()].reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){const value=chunks.get(part.partNumber);bytes.set(value,offset);offset+=value.length}objects.set(key,{bytes,httpMetadata:options?.httpMetadata})},async abort(){chunks.clear()}}},
    async put(key,value,options){objects.set(key,{bytes:new Uint8Array(value),httpMetadata:options?.httpMetadata})},
    async head(key){return objects.has(key)?{size:objects.get(key).bytes.length}:null},
    async get(key){const value=objects.get(key);return value?{body:value.bytes,size:value.bytes.length,httpMetadata:value.httpMetadata}:null},
  }
  const roomContext=()=>{
    const roomDb=new DatabaseSync(':memory:')
    return {db:roomDb,storage:{sql:{exec(query,...args){const s=roomDb.prepare(query),rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>rows,one:()=>rows[0]}}},transactionSync(callback){roomDb.exec('BEGIN');try{const result=callback();roomDb.exec('COMMIT');return result}catch(error){roomDb.exec('ROLLBACK');throw error}}},getWebSockets:()=>[]}
  }
  env.CONTENT_ROOMS={getByName(id){if(!rooms.has(id)){const context=roomContext();rooms.set(id,{context,instance:new SharedContentRoom(context,env)})}return rooms.get(id).instance}}
  const linksContext=roomContext()
  let links=new BoardLinks(linksContext,env)
  env.BOARD_LINKS={getByName(){return links}}
  let directory = new IdentityDirectory(ctx,env)
  env.IDENTITY_DIRECTORY={getByName(name){if(name!=='pizarra-identities-v1')throw new Error('Wrong namespace');return directory}}
  return {
    db, env, objects, rooms, linksContext, close:()=>{db.close();linksContext.db.close();for(const room of rooms.values())room.context.db.close()}, restart:()=>{directory=new IdentityDirectory(ctx,env);links=new BoardLinks(linksContext,env);for(const room of rooms.values())room.instance=new SharedContentRoom(room.context,env)},
    fetch: request => worker.fetch(request,env,{waitUntil(){}}),
    request(path,{body,cookie,method=body ? 'POST':'GET',headers={}}={}) {
      return this.fetch(new Request(`https://backend.test${path}`,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1',...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}))
    },
  }
}
