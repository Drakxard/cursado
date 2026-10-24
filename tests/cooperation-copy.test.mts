import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { authRuntime } from './cloudflare-runtime.mjs'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('copy accepts an invited empty group, keeps the original, isolates a second group and reuses an existing copy',async t=>{
  const bundle=await build({entryPoints:['lib/client/cooperation.ts'],bundle:true,write:false,platform:'browser',format:'esm',plugins:[{name:'copy-workspace',setup(builder){
    builder.onResolve({filter:/local-workspace-client\.ts$/},()=>({path:'root',namespace:'fixture'}))
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const getReadyWorkspaceHandle=()=>globalThis.__copyRoot;export const loadWorkspaceHandle=async()=>globalThis.__copyRoot;export const queryWorkspacePermission=async()=>"granted";export const getReadyInscreenConfigToken=()=>"";export const loadServicesFile=async()=>null'}))
  }}]})
  const backend=authRuntime(),fs=memoryWorkspace(),previous={fetch:globalThis.fetch,window:globalThis.window,storage:globalThis.localStorage,socket:globalThis.WebSocket}
  globalThis.window=new EventTarget() as any;globalThis.localStorage={getItem:()=>null,setItem(){}} as any;globalThis.WebSocket=class{close(){}} as any
  ;(globalThis as any).__copyRoot=fs.root
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
  t.after(()=>{backend.close();globalThis.fetch=previous.fetch;globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.WebSocket=previous.socket;delete (globalThis as any).__copyRoot})
  const actors=[]
  for(const name of ['Rafa','PrimerGrupo','SegundoGrupo','Ajeno']){const response=await backend.request('/api/auth/guest',{body:{name,password:'test-only'}});actors.push({name,cookie:response.headers.get('set-cookie')!.split(';')[0]})}
  const api=(actor:any,path:string,body?:unknown)=>backend.request(`/api/cooperation/${path}`,{cookie:actor.cookie,body})
  const first=(await(await api(actors[0],'groups',{names:actors[1].name})).json()).id
  const second=(await(await api(actors[2],'groups',{names:actors[0].name})).json()).id
  assert.equal((await api(actors[3],`groups/${second}/accept`,{})).status,403)
  assert.equal((await api(actors[3],`groups/${second}/accept/`,{})).status,403)
  assert.equal((await api(actors[0],`groups/${second}/unknown`,{})).status,404)
  const malformed=await api(actors[0],'groups',{})
  assert.equal(malformed.status,422)
  assert.match((await malformed.json()).detail,/nombres de usuario/)
  assert.equal((await(await api(actors[0],'groups')).json()).groups.find(group=>group.id===second).accepted,false)
  globalThis.fetch=(async(url,options={})=>{
    if(String(url)==='/pizarra/upload-session'){const {sphereId,hash,size,mime}=JSON.parse(String(options.body));return backend.request(`/api/cooperation/spheres/${sphereId}/files/${hash}`,{cookie:actors[0].cookie,body:{size,mime}})}
    const target=new URL(String(url),'https://backend.test');target.pathname=target.pathname.replace(/^\/pizarra/,'')
    return backend.fetch(new Request(target,{...options,headers:{...options.headers as any,Origin:backend.env.CURSADO_ORIGIN,Cookie:actors[0].cookie}}))
  }) as typeof fetch
  await fs.put('manifests/subject-catalog.json',{version:2,subjects:{ecu:{id:'ecu',name:'Ecuaciones',storageKey:'Ecu'}}})
  await fs.put('manifests/workspace-state.json',{workspaceTabs:{},activeWorkspaceTabId:'main',isMainWorkspaceTabVisible:true,subjectWeekdays:{},customSubjects:{ecu:{id:'ecu',name:'Ecuaciones',storageKey:'Ecu',tabId:'main',color:'#2563eb'}}})
  const original={version:1,subjectId:'Ecu',weekNumber:1,materials:[{id:100,subject_id:'Ecu',file_name:'Uno.pdf',drive_file_id:'workspace://teoria/Ecu/uno.pdf'}]}
  await fs.put('manifests/materials/Ecu/week-1.json',original)
  await fs.put('teoria/Ecu/uno.pdf',new Blob(['PDF original'],{type:'application/pdf'}))
  await fs.put('progreso/pizarras/original.json',{version:1,boardId:'original',name:'Ecuaciones - Teoría',cooperationSubjectId:'ecu',sharedBoard:{id:'private-link-association'},assets:{},content:{strokes:[],texts:[],media:[],shapes:[],camera:{x:0,y:0,zoom:1}}})
  const client=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
  const source={id:'ecu',name:'Ecuaciones',color:'#2563eb',storageKey:'Ecu'}
  const firstBinding=await client.shareCooperationSphere(first,source)
  assert.equal(firstBinding.subjectId,'ecu')
  const put=fs.files.set.bind(fs.files)
  let failCopy=true
  fs.files.set=(path,value)=>{if(failCopy&&path.startsWith('manifests/materials/Cooperativo-')){failCopy=false;throw new Error('No se pudo guardar la copia local.')}return put(path,value)}
  await assert.rejects(client.shareCooperationSphere(second,source,{copy:true}),/guardar la copia local/)
  assert.equal((await(await api(actors[0],'groups')).json()).groups.find(group=>group.id===second).spheres.length,1)
  const copied=await client.shareCooperationSphere(second,source,{copy:true})
  assert.notEqual(copied.subjectId,'ecu');assert.notEqual(copied.storageKey,'Ecu')
  assert.equal((await(await api(actors[0],'groups')).json()).groups.find(group=>group.id===second).accepted,true)
  assert.deepEqual(await fs.json('manifests/materials/Ecu/week-1.json'),original)
  const manifest=await fs.json(`manifests/materials/${copied.storageKey}/week-1.json`)
  assert.notEqual(manifest.materials[0].id,100)
  assert.equal(manifest.materials[0].drive_file_id,`workspace://teoria/${copied.storageKey}/uno.pdf`)
  assert.equal(await fs.files.get(`teoria/${copied.storageKey}/uno.pdf`).text(),'PDF original')
  const workspace=await fs.json('manifests/workspace-state.json')
  assert.equal(workspace.customSubjects.ecu.tabId,'main')
  assert.deepEqual(workspace.workspaceTabs[`cooperative-${second}`].subjectIds,[copied.subjectId])
  const boards=[...fs.files.keys()].filter(path=>path.startsWith('progreso/pizarras/')&&path!=='progreso/pizarras/original.json')
  assert.equal(boards.length,1);assert.equal((await fs.json(boards[0])).sharedBoard,undefined)
  assert.equal((await client.shareCooperationSphere(second,source,{copy:true})).id,copied.id)
  assert.equal((await(await api(actors[0],'groups')).json()).groups.find(group=>group.id===second).spheres.length,1)
})
