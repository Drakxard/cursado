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
  const localValues=new Map<string,string>()
  globalThis.window=new EventTarget() as any;globalThis.localStorage={getItem:(key:string)=>localValues.get(key)||null,setItem(key:string,value:string){localValues.set(key,value)}} as any;globalThis.WebSocket=class{close(){}} as any
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
  const uploadUser=(await(await api(actors[0],'groups')).json()).user.id
  const pdfHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('PDF original')))].map(value=>value.toString(16).padStart(2,'0')).join('')
  await fs.put(`.cooperation/${uploadUser}/uploads/${pdfHash}`,new Blob(['incomplete staging']))
  const originalArrayBuffer=File.prototype.arrayBuffer
  let staleSnapshot=true
  File.prototype.arrayBuffer=async function(){
    if(this.name==='uno.pdf' && staleSnapshot){staleSnapshot=false;throw new DOMException('The file snapshot was invalidated','NotFoundError')}
    return originalArrayBuffer.call(this)
  }
  t.after(()=>{File.prototype.arrayBuffer=originalArrayBuffer})
  const firstBinding=await client.shareCooperationSphere(first,source)
  assert.equal(firstBinding.subjectId,'ecu')
  assert.equal(staleSnapshot,false,'the stale file snapshot must have been encountered and retried')
  assert.equal(client.cooperationState().mirrors[firstBinding.id].error,undefined)
  assert.equal(await(await api(actors[0],`spheres/${firstBinding.id}/files/${pdfHash}`)).text(),'PDF original','an interrupted staging file must be rebuilt from the verified original')
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
  // Re-linking the original group must also avoid the publishing pipeline,
  // including when there are unrelated pending local edits.
  await fs.put('teoria/Ecu/uno.pdf',new Blob(['Pending local edit'],{type:'application/pdf'}))
  let linkWrites=0
  const fetchBeforeRelink=globalThis.fetch
  globalThis.fetch=(async(url,options={})=>{
    if(String(url).includes('/operations') || String(url).includes('/upload-session') || options.method==='PUT') linkWrites++
    return fetchBeforeRelink(url,options)
  }) as typeof fetch
  assert.equal((await client.shareCooperationSphere(first,source)).id,firstBinding.id)
  assert.equal(linkWrites,0,'linking an existing sphere must not scan/publish pending local changes')
  globalThis.fetch=fetchBeforeRelink
  await fs.put('teoria/Ecu/uno.pdf',new Blob(['PDF original'],{type:'application/pdf'}))
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
  let recoveryUploads=0,newPublications=0
  const fetchBeforeDiscovery=globalThis.fetch
  globalThis.fetch=(async(url,options={})=>{
    if(String(url).includes('/upload-session') || options.method==='PUT') recoveryUploads++
    if(String(url).endsWith('/cooperation/spheres') && options.method==='POST' && !JSON.parse(String(options.body)).sphereId) newPublications++
    return fetchBeforeDiscovery(url,options)
  }) as typeof fetch
  const recovered=await client.shareCooperationSphere(second,source)
  assert.equal(recovered.id,firstBinding.id,'an accessible original is discovered before allocating a second R2 namespace')
  assert.equal(newPublications,0)
  assert.equal(recoveryUploads,0,'losing both local associations must not re-upload existing files')
  globalThis.fetch=fetchBeforeDiscovery
  assert.equal(client.cooperationState().mirrors[firstBinding.id].binding.subjectId,'ecu')
  assert.equal(downloads,0)
  assert.equal((await fs.json('manifests/materials/Ecu/week-1.json')).materials[0].id,100)

  const otherSubject={id:'different-course',name:source.name,storageKey:'DifferentCourse',color:source.color}
  await fs.put('manifests/materials/DifferentCourse/week-1.json',{version:1,subjectId:'DifferentCourse',weekNumber:1,materials:[]})
  const separate=await client.shareCooperationSphere(first,otherSubject)
  assert.notEqual(separate.id,firstBinding.id,'equal display names must not combine unrelated subjects')

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

  await client.removeLocalCooperationSubjects(['prog'])
  const deletedCatalog=await fs.json('manifests/subject-catalog.json')
  delete deletedCatalog.subjects.prog
  await fs.put('manifests/subject-catalog.json',deletedCatalog)
  fs.files.delete('manifests/materials/Prog3/week-1.json')
  await client.refreshCooperation()
  await client.synchronizeCooperation()
  assert.equal(client.cooperationState().mirrors[canonical.id],undefined)
  assert.ok(client.cooperationState().removedSpheres.includes(canonical.id))
  assert.equal(client.cooperationState().groups.some(group=>group.spheres.some(sphere=>sphere.id===canonical.id)),false)
  assert.equal((await fs.json('manifests/subject-catalog.json')).subjects.prog,undefined,'an explicitly deleted sphere must not be recreated by its mirror')
  assert.ok((await(await api(actors[0],`spheres/${canonical.id}/snapshot`)).json()).resources['manifests/materials/Prog3/week-1.json'],'a local removal must not delete collaborators material')

  const raceSource={id:'race',name:'Race',storageKey:'Race',color:'#2563eb'}
  await fs.put('manifests/materials/Race/week-1.json',{materials:[]})
  const race=await client.shareCooperationSphere(first,raceSource)
  await fs.put('manifests/materials/Race/week-1.json',{materials:[{id:5,file_name:'latest local edit'}]})
  const raceState=await fs.json(`.cooperation/${saved.userId}/state.json`)
  raceState.mirrors[race.id].error='Cancelled publication'
  await fs.put(`.cooperation/${saved.userId}/state.json`,raceState)
  await client.refreshCooperation()
  let release!:()=>void,started!:()=>void,undoRequests=0,retired=false,lateCommits=0
  const hold=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{started=resolve})
  const fetchBeforeUndo=globalThis.fetch
  let held=false
  globalThis.fetch=(async(url,options={})=>{
    if(String(url).includes(`spheres/${race.id}/operations`)&&options.method==='POST'){
      if(retired)lateCommits++
      if(!held){held=true;started();await hold}
    }
    if(String(url).includes(`spheres/${race.id}/undo`)){undoRequests++;retired=true}
    return fetchBeforeUndo(url,options)
  }) as typeof fetch
  const active=client.synchronizeCooperation()
  await ready
  const undo=client.undoCooperationSphere(race.id)
  assert.deepEqual(JSON.parse(localValues.get(`cursado-cooperation-undo:${saved.userId}`)!),[race.id],'undo intent survives reload before the active transfer stops')
  assert.equal(client.cooperationUndoStatus(race.id),'stopping','undo reports progress before waiting on an active transfer')
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(undoRequests,0,'remote undo must wait for the in-flight commit')
  release()
  await Promise.all([active,undo])
  await client.synchronizeCooperation()
  assert.deepEqual(JSON.parse(localValues.get(`cursado-cooperation-undo:${saved.userId}`)!),[],'clear durable intent only after saving local cleanup')
  assert.equal(undoRequests,1)
  assert.equal(lateCommits,0)
  assert.equal(client.cooperationState().mirrors[race.id],undefined)
  assert.equal(client.cooperationUndoStatus(race.id),undefined)
  assert.equal((await fs.json('manifests/subject-catalog.json')).subjects.race.cooperationId,undefined)
  assert.equal((await fs.json('manifests/materials/Race/week-1.json')).materials[0].file_name,'latest local edit')

  const revokedSource={id:'revoked',name:'Revoked',storageKey:'Revoked',color:'#2563eb'}
  await fs.put('manifests/materials/Revoked/week-1.json',{materials:[{id:12,file_name:'Keep local'}]})
  const revoked=await client.shareCooperationSphere(first,revokedSource)
  await api(actors[0],`spheres/${revoked.id}/undo`,{})
  await client.synchronizeCooperation()
  assert.equal(client.cooperationState().mirrors[revoked.id],undefined,'a confirmed remote cancellation must not leave a mirror retrying 403 forever')
  assert.equal((await fs.json('manifests/subject-catalog.json')).subjects.revoked.cooperationId,undefined)
  assert.equal((await fs.json('manifests/materials/Revoked/week-1.json')).materials[0].file_name,'Keep local')

  const detachSource={id:'detach',name:'Detach',storageKey:'Detach',color:'#2563eb'}
  await fs.put('manifests/materials/Detach/week-1.json',{materials:[{id:25,file_name:'Keep my original'}]})
  const detach=await client.shareCooperationSphere(first,detachSource)
  await api(actors[1],`groups/${first}/accept`,{})
  const changed=await api(actors[1],`spheres/${detach.id}/operations`,{id:'acknowledged-by-another-client',changes:[{key:'scope/shortcuts.json',type:'json',value:{buttons:[]}}]})
  assert.equal(changed.status,200)
  assert.equal((await api(actors[0],`spheres/${detach.id}/undo`,{})).status,409)
  await client.undoCooperationSphere(detach.id)
  await client.refreshCooperation()
  await client.synchronizeCooperation()
  assert.equal(client.cooperationState().mirrors[detach.id],undefined)
  assert.ok(client.cooperationState().removedSpheres.includes(detach.id))
  assert.equal(client.cooperationState().groups.some(group=>group.spheres.some(sphere=>sphere.id===detach.id)),false)
  assert.equal((await fs.json('manifests/subject-catalog.json')).subjects.detach.cooperationId,undefined)
  assert.equal((await fs.json('manifests/materials/Detach/week-1.json')).materials[0].file_name,'Keep my original')
  assert.equal((await api(actors[1],`spheres/${detach.id}/snapshot`)).status,200,'detaching does not delete another client’s shared copy')

  const offlineSource={id:'offline-undo',name:'Offline undo',storageKey:'OfflineUndo',color:'#2563eb'}
  await fs.put('manifests/materials/OfflineUndo/week-1.json',{materials:[{id:26,file_name:'Keep offline original'}]})
  const offline=await client.shareCooperationSphere(first,offlineSource)
  const fetchBeforeOfflineUndo=globalThis.fetch
  globalThis.fetch=(async(url,options={})=>{
    if(String(url).includes(`spheres/${offline.id}/undo`))throw new TypeError('Failed to fetch')
    return fetchBeforeOfflineUndo(url,options)
  }) as typeof fetch
  await client.undoCooperationSphere(offline.id)
  globalThis.fetch=fetchBeforeOfflineUndo
  assert.equal(client.cooperationState().mirrors[offline.id],undefined)
  assert.equal((await fs.json('manifests/materials/OfflineUndo/week-1.json')).materials[0].file_name,'Keep offline original')

  const checkedSource={id:'access-check',name:'Access check',storageKey:'AccessCheck',color:'#2563eb'}
  await fs.put('manifests/materials/AccessCheck/week-1.json',{materials:[]})
  const checked=await client.shareCooperationSphere(first,checkedSource)
  await fs.put('manifests/materials/AccessCheck/week-1.json',{materials:[{id:33,file_name:'Keep association'}]})
  const fetchBefore403=globalThis.fetch
  globalThis.fetch=(async(url,options={})=>String(url).includes(`spheres/${checked.id}/operations`) ? Response.json({detail:'Temporary forbidden'},{status:403}) : fetchBefore403(url,options)) as typeof fetch
  await client.synchronizeCooperation()
  assert.match(client.cooperationState().mirrors[checked.id].error,/403/)
  assert.equal((await fs.json('manifests/subject-catalog.json')).subjects['access-check'].cooperationId,checked.id,'a rejected request must not detach a sphere still present in the authenticated directory')
  globalThis.fetch=fetchBefore403
  localValues.set(`cursado-cooperation-undo:${saved.userId}`,JSON.stringify([checked.id]))
  const reloaded=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#reload`)
  await reloaded.refreshCooperation()
  assert.equal(reloaded.cooperationState().mirrors[checked.id],undefined,'reload completes an undo saved before cleanup')
  assert.equal((await fs.json('manifests/materials/AccessCheck/week-1.json')).materials[0].file_name,'Keep association')


})
