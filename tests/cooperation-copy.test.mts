import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { authRuntime } from './cloudflare-runtime.mjs'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

test('sharing across groups reuses one sphere, local files and remote content',async t=>{
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
  const beforeFiles=[...fs.files.keys()].sort()
  const beforeSnapshot=await (await api(actors[0],`spheres/${firstBinding.id}/snapshot`)).json()
  const linked=await client.shareCooperationSphere(second,source,{copy:true})
  assert.equal(linked.id,firstBinding.id)
  assert.equal(linked.subjectId,'ecu')
  assert.equal(linked.storageKey,'Ecu')
  assert.equal(Object.keys(client.cooperationState().mirrors).length,1)
  assert.deepEqual([...fs.files.keys()].sort(),beforeFiles)
  assert.deepEqual(await fs.json('manifests/materials/Ecu/week-1.json'),original)
  const workspace=await fs.json('manifests/workspace-state.json')
  assert.deepEqual(workspace.workspaceTabs[`cooperative-${first}`].subjectIds,['ecu'])
  assert.deepEqual(workspace.workspaceTabs[`cooperative-${second}`].subjectIds,['ecu'])
  assert.equal((await client.shareCooperationSphere(second,source,{copy:true})).id,firstBinding.id)
  const groups=(await(await api(actors[0],'groups')).json()).groups
  assert.equal(groups.find(g=>g.id===second).spheres[0].id,firstBinding.id)
  assert.equal(groups.find(g=>g.id===first).spheres[0].id,firstBinding.id)
  assert.deepEqual(await(await api(actors[0],`spheres/${linked.id}/snapshot`)).json(),beforeSnapshot)
  assert.equal((await api(actors[2],`spheres/${linked.id}/snapshot`)).status,200)
  assert.equal((await api(actors[3],`spheres/${linked.id}/snapshot`)).status,403)
  assert.equal((await api(actors[3],'spheres',{groupId:second,sphereId:linked.id,name:source.name,color:source.color})).status,403)
  assert.equal((await api(actors[2],`spheres/${linked.id}/operations`,{id:'participant-edit',changes:[{key:'scope/tags.json',type:'json',value:{tags:[],assignments:{},regions:{}}}]})).status,200)
  const snapshot=await(await api(actors[1],`spheres/${firstBinding.id}/snapshot`)).json()
  // The first group's invited member must accept before accessing shared content.
  assert.match(snapshot.detail,/antes de descargar contenido/)
  await api(actors[1],`groups/${first}/accept`,{})
  assert.ok((await(await api(actors[1],`spheres/${firstBinding.id}/snapshot`)).json()).resources['scope/tags.json'])
  assert.equal([...fs.files.keys()].some(key=>key.includes('/uploads/')),false,'acknowledged uploads must not retain duplicate files')
  // Rebuild the sync state while retaining the user's catalogue and files.
  const saved=await fs.json(`.cooperation/${client.cooperationState().userId}/state.json`)
  saved.mirrors={}
  await fs.put(`.cooperation/${saved.userId}/state.json`,saved)
  await client.refreshCooperation()
  let downloads=0
  const fetchBeforeRestore=globalThis.fetch
  globalThis.fetch=(async(url,options={})=>{
    if(String(url).includes('/files/') && !options.method) downloads++
    return fetchBeforeRestore(url,options)
  }) as typeof fetch
  assert.equal((await client.shareCooperationSphere(second,source,{copy:true})).id,firstBinding.id)
  assert.equal(downloads,0,'existing verified bytes must not be downloaded again')
  const restored=client.cooperationState().mirrors[firstBinding.id].binding
  assert.equal(restored.subjectId,'ecu')
  assert.equal(restored.storageKey,'Ecu')
  assert.deepEqual(Object.keys((await fs.json('manifests/subject-catalog.json')).subjects),['ecu'])
  assert.equal([...fs.files.keys()].some(key=>key.includes('Cooperativo-')),false)

  // A local subject predating cooperation can also be attached when its exact
  // scoped content matches, retaining material IDs and board paths.
  const catalog=await fs.json('manifests/subject-catalog.json')
  delete catalog.subjects.ecu.cooperationId
  await fs.put('manifests/subject-catalog.json',catalog)
  const legacy=await fs.json(`.cooperation/${saved.userId}/state.json`)
  legacy.mirrors={}
  await fs.put(`.cooperation/${saved.userId}/state.json`,legacy)
  await client.refreshCooperation()
  downloads=0
  await client.acceptCooperationSphere(groups.find(g=>g.id===first).spheres[0])
  assert.equal(client.cooperationState().mirrors[firstBinding.id].binding.subjectId,'ecu')
  assert.equal(downloads,0)
  assert.equal((await fs.json('manifests/materials/Ecu/week-1.json')).materials[0].id,100)

  const prog={id:'prog',name:'Prog 3',storageKey:'Prog3',color:'#ff6600'}
  await fs.put('manifests/materials/Prog3/week-1.json',{version:1,subjectId:'Prog3',weekNumber:1,materials:[]})
  const canonical=await client.shareCooperationSphere(first,prog)
  const legacyId=(await(await api(actors[0],'spheres',{groupId:second,name:prog.name,color:prog.color})).json()).id
  const legacySubject=`coop-${legacyId}`,legacyKey=`Cooperativo-${legacyId}`
  const legacyManifest={version:1,subjectId:legacyKey,weekNumber:1,materials:[]}
  await fs.put(`manifests/materials/${legacyKey}/week-1.json`,legacyManifest)
  await api(actors[0],`spheres/${legacyId}/operations`,{id:'legacy-copy',changes:[
    {key:'sphere.json',type:'json',value:{subjectId:legacySubject,storageKey:legacyKey,name:prog.name,color:prog.color}},
    {key:`manifests/materials/${legacyKey}/week-1.json`,type:'json',value:legacyManifest}
  ]})
  const legacySnapshot=await(await api(actors[0],`spheres/${legacyId}/snapshot`)).json()
  assert.equal((await api(actors[0],`spheres/${legacyId}/undo`,{expectedSeq:legacySnapshot.seq-1})).status,409,'a stale repair must never discard a newer commit')
  const legacyState=await fs.json(`.cooperation/${saved.userId}/state.json`)
  legacyState.mirrors[legacyId]={copiedFrom:'prog',binding:{id:legacyId,groupId:second,subjectId:legacySubject,storageKey:legacyKey,sourceId:legacySubject,sourceKey:legacyKey,name:prog.name,color:prog.color,owner:true},baseline:legacySnapshot}
  await fs.put(`.cooperation/${saved.userId}/state.json`,legacyState)
  const legacyCatalog=await fs.json('manifests/subject-catalog.json')
  legacyCatalog.subjects[legacySubject]={id:legacySubject,name:prog.name,storageKey:legacyKey,cooperationId:legacyId}
  await fs.put('manifests/subject-catalog.json',legacyCatalog)
  await client.refreshCooperation()
  const divergent={...legacyManifest,materials:[{id:200,file_name:'Cambio propio'}]}
  await fs.put(`manifests/materials/${legacyKey}/week-1.json`,divergent)
  await api(actors[0],`spheres/${legacyId}/operations`,{id:'divergent-copy',changes:[{key:`manifests/materials/${legacyKey}/week-1.json`,type:'json',value:divergent,base:legacyManifest}]})
  await client.synchronizeCooperation()
  assert.ok(client.cooperationState().mirrors[legacyId],'a legacy copy with unique edits must be preserved')
  assert.equal((await fs.json('manifests/materials/Prog3/week-1.json')).materials.length,0)
  await fs.put(`manifests/materials/${legacyKey}/week-1.json`,legacyManifest)
  await api(actors[0],`spheres/${legacyId}/operations`,{id:'restore-copy',changes:[{key:`manifests/materials/${legacyKey}/week-1.json`,type:'json',value:legacyManifest,base:divergent}]})
  const setFile=fs.files.set.bind(fs.files)
  let interruptRepair=true
  fs.files.set=(path,value)=>{if(interruptRepair&&path==='manifests/subject-catalog.json'){interruptRepair=false;throw new Error('Interrupted repair')}return setFile(path,value)}
  await client.synchronizeCooperation()
  assert.ok(client.cooperationState().mirrors[legacyId].repair,'the repair checkpoint survives a local failure after remote cancellation')
  await client.refreshCooperation()
  await client.synchronizeCooperation()
  assert.equal(client.cooperationState().mirrors[legacyId],undefined,'verified redundant legacy mirrors must be retired')
  assert.equal(client.cooperationState().mirrors[canonical.id].binding.subjectId,'prog')
  assert.equal(fs.files.has(`manifests/materials/${legacyKey}/week-1.json`),false)
  assert.equal((await fs.json('manifests/subject-catalog.json')).subjects[legacySubject],undefined)
  const repairedGroups=(await(await api(actors[0],'groups')).json()).groups
  assert.equal(repairedGroups.find(g=>g.id===second).spheres.some(sphere=>sphere.id===canonical.id),true)
  assert.equal(repairedGroups.find(g=>g.id===second).spheres.some(sphere=>sphere.id===legacyId),false)
  assert.equal((await api(actors[0],`spheres/${legacyId}/snapshot`)).status,403)

})
