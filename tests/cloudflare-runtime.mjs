import { build } from 'esbuild'
import { DatabaseSync } from 'node:sqlite'

const bundle = await build({ entryPoints: ['cloudflare/src/index.js'], bundle:true, write:false, format:'esm', platform:'node',
  plugins:[{name:'cloudflare-test-runtime',setup(builder){
    builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'fixture'}))
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}'}))
  }}],
})
const {default:worker,IdentityDirectory} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

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
  let directory = new IdentityDirectory(ctx,env)
  env.IDENTITY_DIRECTORY={getByName(name){if(name!=='pizarra-identities-v1')throw new Error('Wrong namespace');return directory}}
  return {
    db, env, close:()=>db.close(), restart:()=>{directory=new IdentityDirectory(ctx,env)},
    fetch: request => worker.fetch(request,env,{waitUntil(){}}),
    request(path,{body,cookie,method=body ? 'POST':'GET',headers={}}={}) {
      return this.fetch(new Request(`https://backend.test${path}`,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1',...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}))
    },
  }
}
