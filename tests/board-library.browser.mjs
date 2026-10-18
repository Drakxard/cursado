import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const origin=process.env.CURSADO_TEST_URL||'http://localhost:3000'
function pdfBytes() {
  const ink='0 0 1 rg 20 20 100 100 re f\n'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 4 0 R >>',`<< /Length ${ink.length} >>\nstream\n${ink}endstream`]
  let text='%PDF-1.4\n';const offsets=[0]
  objects.forEach((object,i)=>{offsets.push(text.length);text+=`${i+1} 0 obj\n${object}\nendobj\n`})
  const xref=text.length
  return Array.from(Buffer.from(text+`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`))
}
async function setup(t) {
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'chrome'})})
  t.after(()=>browser.close())
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'})
  const errors=[]
  context.on('page',page=>page.on('pageerror',error=>{errors.push(error.message);console.error('Excepción de navegador:',error.stack)}))
  await context.addInitScript(()=>{try{localStorage.setItem('inscreen.config-skipped.v1','1')}catch{}})
  await context.route('**/pizarra/api/**',route=>route.fulfill({status:401,json:{}}))
  const page=await context.newPage()
  await page.goto(origin)
  await page.evaluate(async bytes=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('board-library-test',{create:true})
    async function write(path,value) {
      const parts=path.split('/');let directory=root
      for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true})
      const writer=await (await directory.getFileHandle(parts.at(-1),{create:true})).createWritable()
      await writer.write(typeof value==='string'||value instanceof Blob?value:JSON.stringify(value));await writer.close()
    }
    const now=new Date().toISOString(),subject={id:'custom-calculo3',name:'Cálculo 3',color:'#0f766e',storageKey:'calculo3',tabId:'main',createdAt:now,targetWeekday:0}
    await write('manifests/workspace-state.json',{workspaceTabs:{},activeWorkspaceTabId:'main',isMainWorkspaceTabVisible:true,subjectWeekdays:{'custom-calculo3':0},customSubjects:{'custom-calculo3':subject}})
    await write('manifests/subject-catalog.json',{version:2,subjects:{'custom-calculo3':{...subject,normalizedName:'calculo 3',updatedAt:now}}})
    for(let week=1;week<=60;week++) await write(`manifests/materials/calculo3/week-${week}.json`,{version:1,subjectId:'custom-calculo3',weekNumber:week,materials:[
      {id:100+week,subject_id:'custom-calculo3',file_name:'Guía de integrales.PDF',drive_file_id:'workspace://teoria/calculo3/guia.pdf',material_type:'theory',week_number:week,weekday_index:0,session_date:now.slice(0,10),created_at:now,updated_at:now,order_index:0},
      {id:200+week,subject_id:'custom-calculo3',file_name:'Resumen.pdf',drive_file_id:'workspace://teoria/calculo3/resumen.pdf',material_type:'theory',week_number:week,weekday_index:0,session_date:now.slice(0,10),created_at:now,updated_at:now,order_index:1},
    ]})
    await write('teoria/calculo3/guia.pdf',new Blob([new Uint8Array(bytes)],{type:'application/pdf'}))
    await write('teoria/calculo3/resumen.pdf',new Blob([new Uint8Array(bytes)],{type:'application/pdf'}))
    await write('progreso/importantes.json',{version:1,tasks:[{id:'exam',text:'Parcial de Cálculo',startDate:'2026-10-01',dueDate:'2026-12-01',url:'',topics:['Integrales'],topicBoardIds:['test-integrales']}]})
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('local-workspace',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspace',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
    await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({id:'root-handle',handle:root});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})
    db.close()
  },pdfBytes())
  t.after(async()=>{
    if(t.error){await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/board-library-failure.png'}).catch(()=>{});console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-4500))}
  })
  return {page,context,errors}
}
async function openTopic(page) {
  await page.goto(origin+'/estudio')
  await page.getByRole('button',{name:/Cálculo 3/}).waitFor({timeout:30000})
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button',{name:'Tema Integrales. Abrir pizarra. Mantener presionado para borrar'}).click()
  const board=page.frameLocator('iframe[title="Pizarra de Parcial de Cálculo · Integrales"]')
  await board.locator('.app canvas').first().waitFor({timeout:30000})
  return board
}
async function topicScene(page) {
  return page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('board-library-test')
    const dir=await (await root.getDirectoryHandle('progreso')).getDirectoryHandle('pizarras')
    return JSON.parse(await (await (await dir.getFileHandle('test-integrales.json')).getFile()).text())
  })
}
test('topic boards use the floating arrow, retain Escape, split with real Study and persist PDF shortcuts without importing pages', {timeout:150000}, async t=>{
  const {page,context,errors}=await setup(t)
  // Reproduce an atomic save invalidating the embedded library's first snapshot.
  await context.addInitScript(()=>{
    const original=Blob.prototype.text
    window.invalidatedWorkspaceSnapshots=0
    Blob.prototype.text=function(...args){
      if(this.name==='workspace-state.json'&&!window.invalidatedWorkspaceSnapshots){
        window.invalidatedWorkspaceSnapshots++
        return Promise.reject(new DOMException('Snapshot replaced by another frame', 'NotReadableError'))
      }
      return original.apply(this,args)
    }
  })
  const board=await openTopic(page)
  await expect(page.getByRole('button',{name:'Volver a Temas',exact:true})).toHaveText('←')
  assert.equal(await page.getByText('Volver · Esc',{exact:true}).count(),0)
  const canvas=board.locator('.app canvas').first()
  await canvas.click({position:{x:180,y:200}})
  await page.keyboard.press('Escape')
  await expect(board.locator('.app')).toHaveAttribute('data-tool','select')
  await board.getByRole('button',{name:'Agregar imagen o PDF',exact:true}).click()
  await board.getByRole('button',{name:'▥ Biblioteca',exact:true}).click()
  await board.getByRole('button',{name:'Abrir mitad y mitad',exact:true}).click()
  await expect(board.locator('.app')).toHaveAttribute('data-library-split','true')
  const library=board.frameLocator('iframe[title="Biblioteca de Estudio"]')
  await library.getByRole('button',{name:/Cálculo 3/}).click({timeout:30000})
  const material=library.getByText('Guía de integrales.PDF',{exact:true}).first().locator('xpath=ancestor::div[@draggable="true"][1]')
  await material.waitFor({timeout:20000})
  assert.ok((await Promise.all(page.frames().map(frame=>frame.evaluate(()=>window.invalidatedWorkspaceSnapshots||0)))).some(count=>count>0))
  const data=await material.evaluate(element=>{
    const data=new DataTransfer();element.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}))
    return data.getData('application/x-cursado-board-pdf')
  })
  assert.ok(data)
  const reference=JSON.parse(data)
  await canvas.evaluate((element,data)=>{
    const transfer=new DataTransfer();transfer.setData('application/x-cursado-board-pdf',data)
    const rect=element.getBoundingClientRect()
    element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+200,clientY:rect.top+300}))
  },data)
  await expect.poll(async()=>(await topicScene(page)).content.shapes?.length).toBe(1)
  const scene=await topicScene(page),shortcut=scene.content.shapes[0]
  assert.equal(shortcut.label,'Guía de integrales')
  assert.deepEqual(shortcut.pdfReference,reference)
  assert.equal(scene.content.media.length,0)
  assert.deepEqual(scene.assets,{})
  // A drag moves the link without opening a reader.
  await page.mouse.move(260,326);await page.mouse.down();await page.mouse.move(330,376,{steps:8});await page.mouse.up()
  assert.equal(await board.locator('.board-pdf-reader').count(),0)
  await expect.poll(async()=>(await topicScene(page)).content.shapes[0].x).toBeGreaterThan(shortcut.x)
  await canvas.click({position:{x:350,y:377}})
  const reader=board.frameLocator('iframe[title="Lector de PDF de la pizarra"]')
  const pdf=reader.frameLocator('iframe[title^="Visor PDF:"]')
  await pdf.locator('.page[data-page-number="1"] canvas').waitFor({timeout:15000}).catch(async error=>{
    for(const frame of page.frames())console.error(frame.url(),(await frame.locator('body').innerText().catch(()=>'' )).slice(-2000))
    console.error(errors)
    await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/board-library-reader-failure.png'})
    throw error
  })
  assert.equal(await page.getByRole('button',{name:'Volver a Temas',exact:true}).count(),0)
  await pdf.locator('body').click({position:{x:40,y:130}})
  await page.keyboard.press('Escape')
  await expect(board.locator('.board-pdf-reader')).toHaveCount(0)
  await expect(board.locator('.app')).toHaveAttribute('data-library-split','true')
  await expect(library.getByText('Guía de integrales.PDF',{exact:true}).first()).toBeVisible()
  // Close the subject dialog first, then Escape closes the split view.
  await library.getByText('Guía de integrales.PDF',{exact:true}).first().focus()
  await page.keyboard.press('Escape')
  await expect(library.getByRole('dialog')).toHaveCount(0)
  await library.locator('body').press('Escape')
  await expect(board.locator('.app')).toHaveAttribute('data-library-split','false')
  await page.getByRole('button',{name:'Volver a Temas',exact:true}).click()
  await expect(page.locator('iframe[title^="Pizarra de"]')).toHaveCount(0)
  await page.getByRole('button',{name:'Tema Integrales. Abrir pizarra. Mantener presionado para borrar'}).click()
  await expect.poll(async()=>(await topicScene(page)).content.shapes.length).toBe(1)
  assert.deepEqual(errors,[])
})

test('topic arrow keeps the board open on a save failure and closes after a successful retry',{timeout:60000},async t=>{
  const {page}=await setup(t),board=await openTopic(page)
  await board.locator('canvas').first().evaluate(()=>{
    const original=FileSystemFileHandle.prototype.createWritable
    window.failTopicSave=true
    FileSystemFileHandle.prototype.createWritable=function(...args){
      if(window.failTopicSave&&this.name==='test-integrales.json')return Promise.reject(new Error('No se pudo escribir la pizarra de prueba.'))
      return original.apply(this,args)
    }
  })
  await page.getByRole('button',{name:'Volver a Temas',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'No se pudo escribir la pizarra de prueba.'}).first()).toBeVisible()
  await expect(board.locator('.app')).toBeVisible()
  await board.locator('canvas').first().evaluate(()=>{window.failTopicSave=false})
  await page.getByRole('button',{name:'Volver a Temas',exact:true}).click()
  await expect(page.locator('iframe[title^="Pizarra de"]')).toHaveCount(0)
})
