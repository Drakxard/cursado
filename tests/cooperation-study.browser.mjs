import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { authRuntime } from './cloudflare-runtime.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const origin=process.env.CURSADO_TEST_URL || 'http://localhost:3007'
const production=process.env.COOP_PRODUCTION_TEST==='1'
test('actual Study references one sphere across groups and accepts its local mirror in another browser',{timeout:production?240000:90000},async t=>{
  const backend=production?{
    close(){},
    request(path,{body,cookie}={}){return fetch(origin+'/pizarra'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})},
  }:authRuntime(origin);t.after(()=>backend.close())
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})});t.after(async()=>{
    if(production||t.error){
      const diagnostics=[]
      for(const context of browser.contexts())for(const page of context.pages())diagnostics.push(await page.evaluate(async()=>{
        const user=localStorage.getItem('cursado-cooperation-user');let state
        try{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study');const dir=await(await root.getDirectoryHandle('.cooperation')).getDirectoryHandle(user);state=JSON.parse(await(await(await dir.getFileHandle('state.json')).getFile()).text())}catch{}
        let catalog,files=[]
        try {
          const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
          catalog=JSON.parse(await(await(await(await root.getDirectoryHandle('manifests')).getFileHandle('subject-catalog.json')).getFile()).text())
          const walk=async(dir,prefix='')=>{for await(const [name,entry]of dir.entries()){const path=prefix+name;if(entry.kind==='directory')await walk(entry,path+'/');else files.push(path)}}
          for(const name of ['teoria','manifests/materials']){let dir=root;for(const segment of name.split('/'))dir=await dir.getDirectoryHandle(segment);await walk(dir,name+'/')}
        } catch {}
        return {url:location.href,body:document.body.innerText,user,state,catalog,files}
      }).catch(error=>({error:error.message})))
      await mkdir('test-results',{recursive:true});await writeFile('test-results/cooperation-study-diagnostics.json',JSON.stringify(diagnostics,null,2))
      if(t.error)console.error('Cooperation diagnostics:',JSON.stringify(diagnostics.map(({state,...diagnostic})=>({...diagnostic,mirrors:Object.values(state?.mirrors||{}).map(m=>({binding:m.binding,error:m.error,downloading:m.downloading,transfer:m.transfer,resources:Object.keys(m.baseline.resources)}))}))))
    }
    await browser.close()
  })
  const livePages=new WeakSet()
  const actors=[]
  const suffix=production?'-'+crypto.randomUUID().slice(0,8):''
  for(const name of ['PersonaA','PersonaB','PersonaC'].map(name=>name+suffix)) {
    const response=await backend.request('/api/auth/guest',{body:{name,password:'browser-cooperation'}})
    assert.equal(response.status,200,await response.clone().text())
    actors.push({name,cookie:response.headers.get('set-cookie').split(';')[0]})
  }
  async function setup(actor,source=false) {
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:900}})
    await context.addCookies([{name:'pizarra_sid',value:actor.cookie.split('=')[1],domain:new URL(origin).hostname,path:'/pizarra/',httpOnly:true}])
    if(!production)await context.route(url=>url.pathname.startsWith('/pizarra/api/')||url.pathname==='/pizarra/upload-session',async route=>{
      const incoming=route.request()
      let path=new URL(incoming.url()).pathname.replace(/^\/pizarra/,'')+new URL(incoming.url()).search
      const headers=new Headers(incoming.headers());headers.set('Origin',origin);headers.set('Cookie',actor.cookie);headers.set('CF-Connecting-IP','192.0.2.1')
      let body=incoming.postDataBuffer()
      if(path==='/upload-session'){
        const {sphereId,hash,size,mime}=incoming.postDataJSON()
        path=`/api/cooperation/spheres/${sphereId}/files/${hash}`
        body=Buffer.from(JSON.stringify({size,mime}))
      }
      const response=await backend.fetch(new Request(`https://backend.test${path}`,{method:incoming.method(),headers,...(body?{body}: {})}))
      if(new URL(incoming.url()).pathname==='/pizarra/upload-session'){
        const result=await response.json()
        if(result.uploadUrl){const upload=new URL(result.uploadUrl);result.uploadUrl=origin+'/pizarra'+upload.pathname+upload.search}
        await route.fulfill({status:response.status,json:result});return
      }
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
    })
    const page=await context.newPage()
    page.on('websocket',socket=>socket.on('framereceived',frame=>{
      try{if(new URL(socket.url()).hostname==='cursado-realtime.dariorafael2005.workers.dev' && JSON.parse(String(frame.payload)).type==='presence')livePages.add(page)}catch{}
    }))
    // Seed the local folder before mounting the application, as a returning user.
    await context.route(origin+'/__cooperation-test-setup',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}))
    await page.goto(origin+'/__cooperation-test-setup')
    await page.evaluate(async source=>{
      localStorage.setItem('inscreen.config-skipped.v1','1')
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study',{create:true})
      async function write(path,value){let dir=root;const parts=path.split('/');for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});const writer=await(await dir.getFileHandle(parts.at(-1),{create:true})).createWritable();await writer.write(typeof value==='string'?value:JSON.stringify(value));await writer.close()}
      const now=new Date().toISOString(),subject={id:'algebra-local',name:'Álgebra cooperativa',storageKey:'Algebra',color:'#2563eb',tabId:'main',createdAt:now,targetWeekday:0}
      await write('manifests/subject-catalog.json',{version:2,subjects:source?{[subject.id]:{...subject,normalizedName:'algebra cooperativa',updatedAt:now}}:{}})
      await write('manifests/workspace-state.json',{workspaceTabs:{},activeWorkspaceTabId:'main',isMainWorkspaceTabVisible:true,subjectWeekdays:{},customSubjects:source?{[subject.id]:subject}:{}})
      if(source){await write('teoria/Algebra/uno.pdf','local PDF bytes');await write('manifests/materials/Algebra/week-0.json',{version:1,subjectId:'Algebra',weekNumber:0,materials:[{id:100,subject_id:'Algebra',file_name:'Uno.pdf',drive_file_id:'workspace://teoria/Algebra/uno.pdf',material_type:'theory',week_number:0,weekday_index:0,session_date:now.slice(0,10),created_at:now,updated_at:now,order_index:0}]})}
      const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('local-workspace',1);q.onupgradeneeded=()=>q.result.createObjectStore('workspace',{keyPath:'id'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})
      await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({id:'root-handle',handle:root});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()
    },source)
    await page.goto(origin)
    await page.bringToFront()
    return page
  }
  const a=await setup(actors[0],true)
  await a.getByRole('button',{name:'Compartir',exact:true}).click()
  await a.getByRole('button',{name:'Estudio cooperativo'}).click()
  await a.getByLabel('Nombre de usuario').fill(`[${actors[1].name}, ${actors[2].name}]`)
  await a.getByRole('button',{name:'Cooperar',exact:true}).click()
  await expect(a.getByRole('dialog',{name:'Compartir'})).toHaveCount(0)
  await a.goto(origin+'/estudio')
  const sphere=a.getByRole('button',{name:/Álgebra cooperativa/}).first()
  await sphere.waitFor()
  await sphere.hover();await a.mouse.down();await a.waitForTimeout(900);await a.mouse.up()
  const options=a.getByRole('dialog',{name:'Opciones de materia'})
  await options.getByRole('button',{name:'Referenciar archivos en…',exact:true}).click()
  await a.getByRole('menuitem',{name:/^Cooperar ·/}).click()
  await expect(options).toHaveCount(0,{timeout:20000})
  let group
  try { await expect.poll(async()=>{const result=await backend.request('/api/cooperation/groups',{cookie:actors[0].cookie});group=(await result.json()).groups[0];return group.spheres.length},{timeout:15000}).toBe(1) }
  catch(error) {
    const diagnostic=await a.evaluate(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study');const dir=await root.getDirectoryHandle('.cooperation');const result=[];for await(const [,user]of dir.entries())if(user.kind==='directory'){const file=await user.getFileHandle('state.json').catch(()=>null);if(file){const state=JSON.parse(await(await file.getFile()).text());result.push(Object.values(state.mirrors).map(m=>({binding:m.binding,error:m.error,keys:Object.keys(m.baseline.resources)})))}}return result})
    throw new Error(`${error.message}\nMirror diagnostics: ${JSON.stringify(diagnostic)}`)
  }
  const sphereId=group.spheres[0].id
  await expect(sphere).toBeVisible()
  const b=await setup(actors[1])
  await b.goto(origin+'/estudio')
  const invitation=b.getByRole('dialog',{name:'Nuevo contenido cooperativo'})
  await invitation.getByRole('heading',{name:'Álgebra cooperativa',exact:true}).waitFor({timeout:30000})
  await invitation.getByRole('button',{name:'Sincronizar todo',exact:true}).click()
  await expect(invitation).toHaveCount(0,{timeout:20000})
  await b.locator('[data-study-workspace-tabs]').focus()
  await b.getByRole('button',{name:'Cooperativo',exact:true}).click()
  await b.getByRole('button',{name:'Álgebra cooperativa',exact:true}).waitFor()
  await expect.poll(()=>b.evaluate(async id=>{try{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study');const file=await(await(await root.getDirectoryHandle('teoria')).getDirectoryHandle('Cooperativo-'+id)).getFileHandle('uno.pdf');return(await file.getFile()).text()}catch{return null}},sphereId),{timeout:30000}).toBe('local PDF bytes')
  await b.reload()
  await b.locator('[data-study-workspace-tabs]').focus()
  await b.getByRole('button',{name:'Cooperativo',exact:true}).click()
  await expect(b.getByRole('button',{name:'Álgebra cooperativa',exact:true})).toBeVisible()
  if(!production){
    const created=await backend.request('/api/cooperation/groups',{cookie:actors[2].cookie,body:{names:actors[0].name}})
    assert.equal(created.status,201)
    const secondGroupId=(await created.json()).id
    await a.reload()
    const originalSphere=a.getByRole('button',{name:/Álgebra cooperativa/}).first()
    await originalSphere.waitFor();await originalSphere.hover();await a.mouse.down();await a.waitForTimeout(900);await a.mouse.up()
    const copyOptions=a.getByRole('dialog',{name:'Opciones de materia'})
    await copyOptions.getByRole('button',{name:'Referenciar archivos en…',exact:true}).click()
    await expect(a.getByRole('menuitem',{name:/^Cooperar ·/})).toHaveCount(2)
    let releaseAcceptance, acceptanceStarted
    const acceptanceGate=new Promise(resolve=>{releaseAcceptance=resolve})
    const acceptanceRequest=new Promise(resolve=>{acceptanceStarted=resolve})
    t.after(()=>releaseAcceptance())
    await a.route(url=>url.pathname===`/pizarra/api/cooperation/groups/${secondGroupId}/accept`,async route=>{
      acceptanceStarted();await acceptanceGate;await route.fallback()
    })
    await a.getByRole('menuitem',{name:/Aceptar y referenciar$/}).click()
    await acceptanceRequest
    await expect(copyOptions).toHaveCount(0,{timeout:1000})
    await expect(a.getByRole('button',{name:'Álgebra cooperativa',exact:true})).toBeVisible()
    await a.locator('[data-study-workspace-tabs]').focus();await a.locator('[data-study-workspace-tabs] button').first().click()
    await expect(a.getByRole('button',{name:/Álgebra cooperativa/}).first()).toBeVisible()
    releaseAcceptance()
    await expect(a.getByRole('button',{name:/Álgebra cooperativa/}).first()).toBeVisible()
    let secondGroup
    await expect.poll(async()=>{const result=await backend.request('/api/cooperation/groups',{cookie:actors[0].cookie});secondGroup=(await result.json()).groups.find(group=>group.id===secondGroupId);return secondGroup?.accepted&&secondGroup.spheres.length===1},{timeout:15000}).toBe(true)
    assert.equal(secondGroup.spheres[0].id,sphereId)
    await expect.poll(async()=>a.evaluate(async groupId=>{
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
      const manifests=await root.getDirectoryHandle('manifests')
      const workspace=JSON.parse(await(await(await manifests.getFileHandle('workspace-state.json')).getFile()).text())
      return workspace.workspaceTabs['cooperative-'+groupId]?.subjectIds
    },secondGroupId),{timeout:15000}).toEqual(['algebra-local'])
    assert.equal(await a.evaluate(async id=>{
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
      const theory=await root.getDirectoryHandle('teoria')
      return !!await theory.getDirectoryHandle('Cooperativo-'+id).catch(()=>null)
    },sphereId),false)
    await a.evaluate(async()=>{
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
      const manifests=await root.getDirectoryHandle('manifests')
      const catalog=JSON.parse(await(await(await manifests.getFileHandle('subject-catalog.json')).getFile()).text())
      const materials=await(await manifests.getDirectoryHandle('materials')).getDirectoryHandle(catalog.subjects['algebra-local'].storageKey)
      const writer=await(await materials.getFileHandle('week-999.json',{create:true})).createWritable()
      await writer.write('{"materials":');await writer.close()
      window.dispatchEvent(new Event('cursado-workspace-saved'))
    })
    await expect.poll(()=>a.evaluate(async id=>{
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
      const user=localStorage.getItem('cursado-cooperation-user')
      const folder=await(await root.getDirectoryHandle('.cooperation')).getDirectoryHandle(user)
      const state=JSON.parse(await(await(await folder.getFileHandle('state.json')).getFile()).text())
      return state.mirrors[id]?.error || ''
    },sphereId),{timeout:15000}).toMatch(/week-999.json/)
    await expect(a.getByRole('complementary',{name:'Sincronización cooperativa'})).toHaveCount(0)
    await expect(a.getByText(/week-999.json/)).toHaveCount(0)
    await a.locator('[data-study-workspace-tabs]').focus()
    await a.getByRole('button',{name:'Cooperativo',exact:true}).click()
    await expect(a.getByText(/week-999.json/).first()).toBeVisible()
    await a.evaluate(async()=>{
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
      const manifests=await root.getDirectoryHandle('manifests')
      const catalog=JSON.parse(await(await(await manifests.getFileHandle('subject-catalog.json')).getFile()).text())
      const materials=await(await manifests.getDirectoryHandle('materials')).getDirectoryHandle(catalog.subjects['algebra-local'].storageKey)
      await materials.removeEntry('week-999.json')
      window.dispatchEvent(new Event('cursado-workspace-saved'))
    })
    const invited=await backend.request('/api/cooperation/groups',{cookie:actors[1].cookie,body:{names:actors[0].name}})
    assert.equal(invited.status,201)
    const invitedGroupId=(await invited.json()).id
    await a.reload()
    await a.locator('[data-study-workspace-tabs]').focus()
    await a.getByRole('button',{name:'Cooperativo',exact:true}).click()
    const pendingGroup=a.locator(`[data-cooperation-group="${invitedGroupId}"]`)
    await pendingGroup.getByRole('button',{name:'Aceptar invitación',exact:true}).click()
    await expect(pendingGroup.getByRole('button',{name:'Aceptar invitación',exact:true})).toHaveCount(0)
    const acceptedGroups=await(await backend.request('/api/cooperation/groups',{cookie:actors[0].cookie})).json()
    assert.equal(acceptedGroups.groups.find(group=>group.id===invitedGroupId).accepted,true)
    await a.reload()
    await a.locator('[data-study-workspace-tabs]').focus()
    await a.getByRole('button',{name:'Cooperativo',exact:true}).click()
    await expect(pendingGroup.getByText('Este grupo está vacío.',{exact:true})).toBeVisible()
    await expect(pendingGroup.getByRole('button',{name:'Aceptar invitación',exact:true})).toHaveCount(0)
    return
  }
  const c=await setup(actors[2]);await c.goto(origin+'/estudio')
  const inviteC=c.getByRole('dialog',{name:'Nuevo contenido cooperativo'})
  await inviteC.getByRole('button',{name:'Cancelar',exact:true}).click({timeout:30000})
  await c.locator('[data-study-workspace-tabs]').focus()
  await c.getByRole('button',{name:'Cooperativo',exact:true}).click()
  const gray=c.getByRole('button',{name:'Álgebra cooperativa',exact:true})
  assert.match(await gray.getAttribute('class'),/grayscale/)
  await gray.click();await c.getByRole('dialog',{name:'Nuevo contenido cooperativo'}).getByRole('button',{name:'Confirmar',exact:true}).click()
  await expect(c.getByRole('dialog',{name:'Nuevo contenido cooperativo'})).toHaveCount(0,{timeout:30000})
  async function disk(page,action,options={}) {
    return page.evaluate(async({action,options,sphereId})=>{
      const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('cooperation-study')
      async function file(path){let dir=root;const parts=path.split('/');for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);return dir.getFileHandle(parts.at(-1))}
      const user=localStorage.getItem('cursado-cooperation-user')
      const state=JSON.parse(await(await(await file(`.cooperation/${user}/state.json`)).getFile()).text())
      if(action==='state')return state
      const path=`manifests/materials/${state.mirrors[sphereId].binding.storageKey}/week-0.json`
      const handle=await file(path),manifest=JSON.parse(await(await handle.getFile()).text())
      if(action==='read')return manifest
      if(action==='edit')manifest.materials[0].file_name=options.name
      if(action==='delete')manifest.materials=[]
      const writer=await handle.createWritable();await writer.write(JSON.stringify(manifest));await writer.close()
      dispatchEvent(new Event('cursado-workspace-saved'))
    },{action,options,sphereId})
  }
  await expect.poll(async()=>(await disk(c,'read')).materials[0]?.file_name,{timeout:30000}).toBe('Uno.pdf')
  await expect.poll(()=>[a,b,c].filter(page=>livePages.has(page)).length,{timeout:30000}).toBe(3)
  await b.context().setOffline(true)
  await disk(b,'edit',{name:'Editado sin conexión.pdf'})
  await b.waitForTimeout(4500)
  assert.equal((await disk(b,'read')).materials[0].file_name,'Editado sin conexión.pdf')
  await b.context().setOffline(false)
  await expect.poll(async()=>(await disk(a,'read',{owner:true})).materials[0]?.file_name,{timeout:45000}).toBe('Editado sin conexión.pdf')
  await expect.poll(async()=>(await disk(c,'read')).materials[0]?.file_name,{timeout:45000}).toBe('Editado sin conexión.pdf')
  await disk(a,'delete',{owner:true})
  const reviewB=b.getByRole('dialog',{name:'Elemento eliminado'})
  await expect.poll(async()=>(await disk(b,'state')).deletions.some(d=>d.decision==='wait'),{timeout:30000}).toBe(true)
  await expect(reviewB).toHaveCount(0)
  assert.equal((await disk(b,'read')).materials.length,1)
  await b.reload();await b.locator('[data-study-workspace-tabs]').focus();await b.getByRole('button',{name:'Cooperativo',exact:true}).click()
  await expect(b.getByText('¿Conservar?',{exact:true}).first()).toBeVisible()
  assert.equal((await disk(b,'read')).materials.length,1)
  await b.getByRole('button',{name:/^Conservar /}).first().click()
  await c.locator('[data-study-workspace-tabs]').focus();await c.getByRole('button',{name:'Cooperativo',exact:true}).click()
  await c.getByRole('button',{name:/^Descartar copia local de /}).first().click({timeout:30000})
  await expect.poll(async()=>(await disk(c,'read')).materials.length,{timeout:30000}).toBe(0)
  assert.equal((await disk(b,'read')).materials.length,1)
  await b.reload()
  await expect.poll(async()=>(await disk(b,'state')).deletions.some(d=>d.decision==='keep'),{timeout:30000}).toBe(true)
  await b.waitForTimeout(8500)
  assert.equal((await disk(a,'read',{owner:true})).materials.length,0)
  assert.equal((await disk(b,'state')).deletions.some(d=>d.decision==='wait'),false)
  assert.equal(await b.getByRole('dialog',{name:'Elemento eliminado'}).count(),0)
  const login=await backend.request('/api/auth/login',{body:{name:actors[0].name,password:'browser-cooperation'}})
  assert.equal(login.status,200)
  await a.goto(origin)
  await a.getByRole('button',{name:'Compartir',exact:true}).click()
  await a.getByRole('button',{name:'Sincronizar dispositivos'}).click()
  await expect(a.getByRole('dialog',{name:'Sincronizá tus dispositivos'})).toBeVisible()
})
