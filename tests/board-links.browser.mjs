import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { authRuntime } from './cloudflare-runtime.mjs'

const origin='https://sharing.test'
const empty=()=>({strokes:[],texts:[],media:[],shapes:[],tables:[],graphs:[],videos:[],camera:{x:0,y:0,zoom:1}})
const shortcut=(id,target,name,x=180)=>({id,kind:'rounded',visualType:'board-shortcut',boardReference:{boardId:target,name},label:name,x,y:300,width:320,height:54,color:'#2563eb',strokeWidth:1.5})
function pdfBytes(){
  const ink='0 0 1 rg 20 20 100 100 re f\n',objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 4 0 R >>',`<< /Length ${ink.length} >>\nstream\n${ink}endstream`]
  let text='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(text.length);text+=`${i+1} 0 obj\n${object}\nendobj\n`});const xref=text.length
  return [...Buffer.from(text+`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]
}

test('two browsers share the original, navigate a cyclic chain, keep offline work and revoke the link',{timeout:120000},async t=>{
  const backend=authRuntime(origin);t.after(()=>backend.close())
  const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome'});t.after(()=>browser.close())
  const errors=[]
  async function context(){
    const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})
    context.on('page',page=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource')&&!message.text().includes('WebSocket'))console.error(message.text())})})
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),path=url.pathname
      if(path==='/seed'||path==='/biblioteca/publicador')return route.fulfill({contentType:'text/html',body:'<html></html>'})
      if(path==='/topic-host')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/pizarra/?topicBoard=topic-d"></iframe><script>
        window.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==document.querySelector('iframe').contentWindow||event.data?.type!=='topic-board:request-init')return;const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sharing-root');event.source.postMessage({type:'topic-board:init',boardId:'topic-d',name:'Tema D',rootHandle:root},location.origin)});
      </script>`})
      if(path.startsWith('/pizarra/api/board-links/')||path.startsWith('/api/board-links/')){
        if(context.simulatedOffline)return route.abort('internetdisconnected')
        const headers=await request.allHeaders();headers.origin=origin
        const response=await backend.fetch(new Request(`https://backend.test${path.replace(/^\/pizarra/,'')}${url.search}`,{method:request.method(),headers,...(['GET','HEAD'].includes(request.method())?{}:{body:request.postDataBuffer()})}))
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
      }
      if(path.includes('/api/'))return route.fulfill({status:401,json:{detail:'No session'}})
      const directory=resolve('public'),file=resolve(directory,'.'+(path==='/pizarra/'?'/pizarra/index.html':path))
      assert.ok(file.startsWith(directory+sep))
      try{return route.fulfill({body:await readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}
    })
    return context
  }
  const ownerContext=await context(),guestContext=await context()
  const owner=await ownerContext.newPage();await owner.goto(origin+'/seed')
  const a=empty(),b=empty(),c=empty(),d=empty();a.shapes=[shortcut('to-b','local:b','Pizarra B'),shortcut('missing','local:deleted','Pizarra eliminada',600)];b.shapes=[shortcut('to-c','local:c','Pizarra C'),shortcut('to-a','local:a','Pizarra A',600)]
  a.media=[{id:'image-object',assetId:'image-a',name:'test.svg',kind:'image',x:1100,y:350,width:64,height:64}]
  c.shapes=[shortcut('to-d','local:important-topic-d','Tema D')]
  d.shapes=[{id:'pdf',kind:'rounded',visualType:'pdf-shortcut',pdfPinned:true,pdfReference:{materialId:1,subjectId:'calculo',workspaceFileId:'workspace://teoria/test.pdf',fileName:'test.pdf'},label:'Test PDF',x:180,y:300,width:320,height:54,color:'#2563eb',strokeWidth:1.5}]
  await owner.evaluate(async({boards,topic,pdf})=>{
    localStorage.setItem('pizarra-modo-local-preferido','1');localStorage.setItem('pizarra_activa','local:a')
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('boards',{keyPath:'key'});db.createObjectStore('folders',{keyPath:'id'});db.createObjectStore('history',{keyPath:'id'});for(const name of ['assets','meta'])db.createObjectStore(name)};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    await new Promise((resolve,reject)=>{const tx=db.transaction(['boards','assets'],'readwrite');for(const [id,content] of Object.entries(boards))tx.objectStore('boards').put({key:`local:${id}`,id:`local:${id}`,name:`Pizarra ${id.toUpperCase()}`,folder_id:null,storage:'private',version:0,updated_at:new Date().toISOString(),content});tx.objectStore('assets').put(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>'],{type:'image/svg+xml'}),'device:image-a');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})
    db.close()
    const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sharing-root',{create:true})
    async function put(path,value){const parts=path.split('/');let directory=root;for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true});const writer=await(await directory.getFileHandle(parts.at(-1),{create:true})).createWritable();await writer.write(value);await writer.close()}
    await put('teoria/test.pdf',new Blob([new Uint8Array(pdf)],{type:'application/pdf'}))
    await put('progreso/pizarras/topic-d.json',JSON.stringify({version:1,boardId:'topic-d',name:'Tema D',content:topic,assets:{}}))
    const request=indexedDB.open('local-workspace',1);const workspaceDb=await new Promise(resolve=>{request.onupgradeneeded=()=>request.result.createObjectStore('workspace');request.onsuccess=()=>resolve(request.result)})
    await new Promise(resolve=>{const tx=workspaceDb.transaction('workspace','readwrite');tx.objectStore('workspace').put({handle:root},'root-handle');tx.oncomplete=resolve});workspaceDb.close()
  },{boards:{a,b,c},topic:d,pdf:pdfBytes()})
  await owner.goto(origin+'/pizarra/');await expect(owner.locator('.app')).toBeVisible()
  await owner.getByRole('button',{name:'Agregar imagen o PDF',exact:true}).click()
  await owner.getByRole('button',{name:'Compartir via link',exact:true}).click()
  const linkField=owner.getByRole('textbox',{name:'Enlace para compartir'})
  await expect(linkField).toBeVisible({timeout:30000})
  const link=await linkField.inputValue()
  await owner.getByRole('button',{name:'Cerrar',exact:true}).click()
  const guest=await guestContext.newPage();await guest.goto(link)
  await expect(guest.locator('.app')).toBeVisible({timeout:30000})
  await expect(guest.locator('.library-open-button')).toContainText('Pizarra A',{timeout:30000})
  await expect.poll(()=>guest.locator('.app > canvas').first().evaluate(canvas=>{const dpr=devicePixelRatio;const pixel=canvas.getContext('2d').getImageData(1120*dpr,380*dpr,1,1).data;return pixel[0]>200&&pixel[1]<40&&pixel[2]<40}),{timeout:15000}).toBe(true)
  await expect(guest.getByRole('textbox',{name:'Nombre'})).toHaveCount(0)
  // Draw in the guest; the owner must receive the edit on the original local ID.
  await guest.keyboard.press('p');await guest.mouse.move(800,500);await guest.mouse.down();await guest.mouse.move(960,570,{steps:8});await guest.mouse.up()
  const scene=page=>page.evaluate(async()=>{const request=indexedDB.open('pizarra-dispositivo',1);const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const tx=db.transaction('boards');const read=tx.objectStore('boards').get(localStorage.getItem('pizarra_activa')||'local:a');const result=await new Promise(resolve=>read.onsuccess=()=>resolve(read.result));db.close();return result?.content})
  await expect.poll(async()=>{const value=await scene(owner);return value?.strokes.length},{timeout:30000}).toBe(1)
  assert.equal(await owner.evaluate(()=>localStorage.getItem('pizarra_activa')),'local:a')
  await guest.keyboard.press('v');await guest.mouse.click(300,326)
  await expect(guest.locator('.library-open-button[title="Mis pizarras"]')).toContainText('Pizarra B',{timeout:15000})
  await guest.mouse.click(300,326)
  await expect(guest.locator('.library-open-button[title="Mis pizarras"]')).toContainText('Pizarra C',{timeout:15000})
  await guest.mouse.click(300,326)
  await expect(guest.locator('.library-open-button[title="Mis pizarras"]')).toContainText('Tema D',{timeout:15000})
  await guest.getByRole('button',{name:'Abrir PDF fijado Test PDF',exact:true}).click()
  const pdf=guest.frameLocator('iframe[title="Leer test.pdf"]')
  await expect(pdf.locator('.page[data-page-number="1"] canvas').first()).toBeVisible({timeout:30000})
  await pdf.locator('body').click({position:{x:800,y:120}});await guest.keyboard.press('<')
  await expect(guest.locator('.board-pdf-reader[aria-modal="true"]')).toHaveCount(0)
  await expect(guest.locator('iframe[title="Leer test.pdf"]')).toHaveCount(1)
  await guest.getByRole('button',{name:'Abrir PDF fijado Test PDF',exact:true}).click()
  await expect(guest.locator('.board-pdf-reader[aria-modal="true"]')).toHaveCount(1)
  await pdf.locator('body').click({position:{x:800,y:120}});await guest.keyboard.press('<')
  await expect(guest.locator('.board-pdf-reader[aria-modal="true"]')).toHaveCount(0)
  await guest.keyboard.press('p');await guest.mouse.move(800,500);await guest.mouse.down();await guest.mouse.move(950,560,{steps:8});await guest.mouse.up()
  await expect.poll(async()=>guest.evaluate(async()=>{const request=indexedDB.open('pizarra-dispositivo');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const read=db.transaction('boards').objectStore('boards').getAll();const records=await new Promise(resolve=>read.onsuccess=()=>resolve(read.result));db.close();return records.find(board=>board.name==='Tema D')?.content.strokes.length}),{timeout:15000}).toBe(1)
  // Recover the association from the synchronized topic file, as on another device.
  const originalSharedId=await owner.evaluate(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sharing-root'),directory=await(await root.getDirectoryHandle('progreso')).getDirectoryHandle('pizarras');const snapshot=JSON.parse(await(await(await directory.getFileHandle('topic-d.json')).getFile()).text());const request=indexedDB.open('pizarra-dispositivo');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));await new Promise(resolve=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').delete('board-link-binding:local:important-topic-d');tx.oncomplete=resolve});db.close();return snapshot.sharedBoard.id})
  const topicOwner=await ownerContext.newPage();await topicOwner.goto(origin+'/topic-host')
  const topicFrame=topicOwner.frameLocator('iframe').locator('.app')
  await expect(topicFrame).toBeVisible({timeout:30000})
  await expect.poll(async()=>topicOwner.evaluate(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sharing-root'),dir=await(await root.getDirectoryHandle('progreso')).getDirectoryHandle('pizarras');return JSON.parse(await(await(await dir.getFileHandle('topic-d.json')).getFile()).text()).content.strokes.length}),{timeout:30000}).toBe(1)
  assert.equal(await topicOwner.evaluate(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('sharing-root'),directory=await(await root.getDirectoryHandle('progreso')).getDirectoryHandle('pizarras');return JSON.parse(await(await(await directory.getFileHandle('topic-d.json')).getFile()).text()).sharedBoard.id}),originalSharedId)
  await topicOwner.close()
  await guest.reload();await expect(guest.locator('.app')).toBeVisible()
  await expect(guest.locator('.library-open-button[title="Mis pizarras"]')).toContainText('Pizarra A')
  guestContext.simulatedOffline=true
  await guest.keyboard.press('p');await guest.mouse.move(800,650);await guest.mouse.down();await guest.mouse.move(950,710,{steps:8});await guest.mouse.up()
  await expect.poll(async()=>guest.evaluate(async()=>{const request=indexedDB.open('pizarra-dispositivo');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));const read=db.transaction('boards').objectStore('boards').getAll();const records=await new Promise(resolve=>read.onsuccess=()=>resolve(read.result));db.close();return records.find(board=>board.name==='Pizarra A')?.content.strokes.length}),{timeout:15000}).toBe(2)
  await owner.keyboard.press('p');await owner.mouse.move(750,720);await owner.mouse.down();await owner.mouse.move(920,760,{steps:8});await owner.mouse.up()
  await expect.poll(async()=>(await scene(owner))?.strokes.length,{timeout:15000}).toBe(2)
  guestContext.simulatedOffline=false
  await expect.poll(async()=>(await scene(owner))?.strokes.length,{timeout:30000}).toBe(3)
  // Reload starts at the link root. The link is stable in the profile menu too.
  await owner.getByRole('button',{name:/Abrir perfil/}).click()
  await owner.getByRole('button',{name:'Compartir pizarra actual'}).click()
  await expect(owner.getByRole('textbox',{name:'Enlace para compartir'})).toHaveValue(link,{timeout:30000})
  await owner.getByRole('button',{name:'Desactivar enlace'}).click()
  await expect(owner.getByRole('status')).toContainText('Enlace desactivado.')
  await guest.reload();await expect(guest.getByRole('alert')).toContainText('desactivado',{timeout:15000})
  assert.deepEqual(errors,[])
})
