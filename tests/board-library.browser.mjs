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
  await material.waitFor({timeout:60000})
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
  assert.equal(await board.locator('.board-pdf-reader[aria-hidden="false"]').count(),0)
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
  await expect(board.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
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

test('pin follows the PDF, < reloads the reader with its zoom, API chat captures visible board layers',{timeout:150000},async t=>{
  const {page,context,errors}=await setup(t)
  // Isolate board behavior from subject-catalog migrations, while keeping real PDF.js.
  await context.route('**/board-test.pdf',route=>route.fulfill({contentType:'application/pdf',body:Buffer.from(pdfBytes())}))
  await context.route(url=>url.pathname==='/biblioteca/pizarra'&&url.searchParams.get('mode')==='reader',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><script>
    const params=new URLSearchParams(location.search),session=params.get('session'),boardId=params.get('boardId');let frame,position;
    const send=type=>parent.postMessage({type,session,boardId},location.origin);
    addEventListener('message',e=>{
      if(e.origin!==location.origin)return;
      if(e.source===parent&&e.data.session===session&&e.data.boardId===boardId){
        if(e.data.type==='board-library:init'&&!frame){position=e.data.readingPosition;frame=document.createElement('iframe');frame.title='Visor PDF: fixture';frame.src='/pdfjs/web/viewer.html?file=%2Fboard-test.pdf&viewerMode=inline&boardReader=1';document.body.append(frame)}
        if(e.data.type==='board-library:escape-reader')frame?.contentWindow.postMessage({type:'requestViewerEscape'},location.origin);
      }
      if(e.source===frame?.contentWindow){
        if(e.data.type==='viewerPageRendered'){if(position){frame.contentWindow.postMessage({type:'restoreViewerReadingPosition',hash:position},location.origin);position=null}send('board-library:reader-rendered')}
        if(e.data.type==='viewerReadingPosition'&&!position)parent.postMessage({type:'board-library:reading-position',session,boardId,hash:e.data.hash},location.origin);
        if(e.data.type==='viewerRequestClose')send('board-library:reader-closed');
      }
    });addEventListener('DOMContentLoaded',()=>send('board-library:ready'));
  </script>`}))
  await page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('board-library-test')
    const dir=await (await root.getDirectoryHandle('progreso',{create:true})).getDirectoryHandle('pizarras',{create:true})
    const tile=document.createElement('canvas');tile.width=100;tile.height=100
    const ctx=tile.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,100)
    const reference={materialId:101,subjectId:'custom-calculo3',fileName:'Guía de integrales.PDF',workspaceFileId:'workspace://teoria/calculo3/guia.pdf'}
    const scene={version:1,boardId:'test-integrales',name:'Integrales',assets:{red:tile.toDataURL()},content:{
      camera:{x:0,y:0,zoom:1},strokes:[],texts:[{id:'text',x:100,y:150,text:'Prueba de captura',fontSize:24,color:'#000000'}],
      shapes:[{id:'pdf',kind:'rounded',visualType:'pdf-shortcut',pdfReference:reference,label:'Guía de integrales',x:100,y:250,width:280,height:54,color:'#2563eb',strokeWidth:1.5}],
      media:[{id:'image',assetId:'red',x:60,y:450,width:100,height:100,name:'Imagen roja',kind:'image'},
        {id:'fragment',assetId:'red',x:190,y:450,width:100,height:100,name:'Fragmento PDF',kind:'pdf-page',pageNumber:1}],
      tables:[{id:'table',name:'Tabla',x:500,y:180,cells:[[{value:'42'}]],cellWidth:90,cellHeight:32}],
      graphs:[{id:'graph',x:850,y:200,width:350,height:250,formulas:[{id:'f',expr:'x^2',color:'#16a34a',enabled:true}]}],
    }}
    const writer=await (await dir.getFileHandle('test-integrales.json',{create:true})).createWritable();await writer.write(JSON.stringify(scene));await writer.close()
  })
  const board=await openTopic(page),canvas=board.locator('.app > canvas').first()
  await canvas.press('Escape')
  await canvas.focus();assert.equal(await canvas.evaluate(el=>getComputedStyle(el).outlineStyle),'none')
  // Dragging selects the link without opening it.
  const box=await canvas.boundingBox()
  await page.mouse.move(box.x+180,box.y+275);await page.mouse.down();await page.mouse.move(box.x+190,box.y+280,{steps:4});await page.mouse.up()
  const pin=board.getByRole('button',{name:'Fijar PDF Guía de integrales',exact:true})
  await expect(pin).toBeVisible();assert.equal(await board.locator('.math-dock .pdf-pin-control').count(),0)
  const before=await pin.boundingBox()
  await board.locator('.zoom-controls').getByRole('button',{name:'Acercar',exact:true}).click()
  await expect.poll(async()=>{const after=await pin.boundingBox();return Math.hypot(after.x-before.x,after.y-before.y)}).toBeGreaterThan(1).catch(async error=>{await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/board-pin-failure.png'});throw error})
  // Restore the viewport so capture pixels have deterministic world coordinates.
  await board.locator('.zoom-controls').getByRole('button',{name:'Alejar',exact:true}).click()
  await pin.click()
  await expect(board.getByRole('button',{name:'Abrir PDF fijado Guía de integrales',exact:true})).toHaveCount(1)
  await canvas.press('<')
  const pdf=board.frameLocator('iframe[title="Lector de PDF de la pizarra"]').frameLocator('iframe[title^="Visor PDF:"]')
  await pdf.locator('.page[data-page-number="1"] canvas').waitFor({timeout:45000}).catch(async error=>{for(const frame of page.frames())console.error(frame.url(),(await frame.locator('body').innerText().catch(()=>'' )).slice(-1500));console.error(errors);throw error})
  await expect(board.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(1)
  await pdf.locator('body').evaluate(()=>{window.PDFViewerApplication.pdfViewer.currentScaleValue='1.5'})
  await expect.poll(()=>pdf.locator('body').evaluate(()=>window.PDFViewerApplication.pdfViewer.currentScale)).toBe(1.5)
  await page.waitForTimeout(200)
  await pdf.locator('body').press('<')
  await expect(board.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await expect(board.locator('.board-pdf-reader iframe')).toHaveCount(0)
  await canvas.press('<');await expect(board.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(1)
  await expect.poll(()=>pdf.locator('body').evaluate(()=>window.PDFViewerApplication?.pdfViewer?.currentScale)).toBe(1.5)
  await pdf.locator('body').press('<');await expect(board.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await canvas.press('t');await canvas.click({position:{x:150,y:160}})
  const textEditor=board.locator('textarea.text-editor')
  await expect(textEditor).toBeVisible();await textEditor.press('<')
  assert.ok((await textEditor.inputValue()).includes('<'))
  await expect(board.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await textEditor.press('Escape')
  const calls=[]
  await context.route('**/api/board-chat',async route=>{calls.push(route.request().postDataJSON());await route.fulfill({json:{answer:'Respuesta \\(x^2\\)'}})})
  await board.getByRole('button',{name:'IA: opciones de reconocimiento',exact:true}).click()
  await board.getByRole('menuitem').filter({hasText:'API chat'}).click()
  const prompt=board.getByRole('textbox',{name:'Pregunta para GPT-5 mini'})
  await expect(prompt).toBeFocused({timeout:30000})
  await prompt.fill('Explicá < esto');await prompt.press('Enter')
  await expect(board.locator('.board-api-chat-answer .katex')).toHaveCount(1)
  assert.equal(calls.length,1)
  const capture=await canvas.evaluate(async(el,image)=>{
    const bitmap=new Image();bitmap.src=image;await bitmap.decode()
    const out=document.createElement('canvas');out.width=bitmap.width;out.height=bitmap.height;const ctx=out.getContext('2d');ctx.drawImage(bitmap,0,0)
    const pixels=(x,y)=>[...ctx.getImageData(Math.round(x*bitmap.width/el.clientWidth),Math.round(y*bitmap.height/el.clientHeight),1,1).data]
    const ink=(x,y,w,h)=>{
      const data=ctx.getImageData(Math.round(x*bitmap.width/el.clientWidth),Math.round(y*bitmap.height/el.clientHeight),Math.round(w*bitmap.width/el.clientWidth),Math.round(h*bitmap.height/el.clientHeight)).data
      let count=0;for(let i=0;i<data.length;i+=4)if(Math.min(data[i],data[i+1],data[i+2])<200)count++
      return count
    }
    return {width:bitmap.width,height:bitmap.height,image:pixels(100,500),fragment:pixels(230,500),toolbar:pixels(700,30),tableInk:ink(500,180,150,110),graphInk:ink(850,200,350,250)}
  },calls[0].image)
  assert.deepEqual(capture.image,[255,0,0,255]);assert.deepEqual(capture.fragment,[255,0,0,255])
  assert.deepEqual(capture.toolbar,[255,255,255,255])
  assert.ok(capture.tableInk>20);assert.ok(capture.graphInk>100)
  await prompt.press('Escape');await expect(board.getByRole('dialog',{name:'API chat',exact:true})).toHaveCount(0)
  await expect(canvas).toBeFocused()
  assert.deepEqual(errors,[])
})

test('NotebookLM resolves the PDF week, configures by hold and falls back without using another week',{timeout:120000},async t=>{
  const {page,errors}=await setup(t)
  await page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('board-library-test')
    const dir=await root.getDirectoryHandle('manifests')
    const writer=await (await dir.getFileHandle('subject-shortcuts.json',{create:true})).createWritable()
    await writer.write(JSON.stringify({calculo3:{subjectId:'calculo3',buttons:[{id:'nlm-test',label:'nlm',orderIndex:0,url:null,sectionScoped:true,sectionUrls:{'week:1':'https://notebook.google.com/notebook/week-one','week:2':'https://notebook.google.com/notebook/week-two'},integrationRole:'notebooklm',activeSectionKey:'week:2'}]}}));await writer.close()
  })
  await page.goto(origin+'/practice/viewer?materialId=101')
  let viewer=page.frameLocator('iframe[title^="Visor PDF:"]')
  const link=viewer.getByRole('link',{name:'Abrir nlm',exact:true})
  await expect(link).toHaveAttribute('href','https://notebook.google.com/notebook/week-one',{timeout:30000})
  const box=await link.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect(page.getByRole('dialog',{name:'Configurar NotebookLM'})).toBeVisible()
  await page.getByRole('textbox',{name:'Enlace de NotebookLM'}).fill('https://notebook.google.com/notebook/updated-week-one')
  await page.getByRole('button',{name:'Guardar',exact:true}).click()
  await expect(link).toHaveAttribute('href','https://notebook.google.com/notebook/updated-week-one')
  await page.goto(origin+'/practice/viewer?materialId=102')
  viewer=page.frameLocator('iframe[title^="Visor PDF:"]')
  await expect(viewer.getByRole('link',{name:'Abrir nlm',exact:true})).toHaveAttribute('href','https://notebook.google.com/notebook/week-two',{timeout:30000})
  await page.goto(origin+'/practice/viewer?materialId=103')
  viewer=page.frameLocator('iframe[title^="Visor PDF:"]')
  await expect(viewer.getByRole('link',{name:'Abrir nlm',exact:true})).toHaveAttribute('href','https://notebook.google.com/',{timeout:30000})
  assert.deepEqual(errors,[])
})

test('the PDF pencil renames on click and opens synthesis only on hold',{timeout:120000},async t=>{
  const {page,context}=await setup(t)
  const board=await openTopic(page)
  await board.getByRole('button',{name:'Agregar imagen o PDF',exact:true}).click()
  await board.getByRole('button',{name:'▥ Biblioteca',exact:true}).click()
  await board.getByRole('button',{name:'Abrir mitad y mitad',exact:true}).click()
  const library=board.frameLocator('iframe[title="Biblioteca de Estudio"]')
  await library.getByRole('button',{name:/Cálculo 3/}).click({timeout:30000})
  const pencil=library.getByRole('button',{name:'Renombrar Guía de integrales.PDF',exact:true}).first()
  const oldReference=await pencil.evaluate(element=>{
    const transfer=new DataTransfer()
    element.closest('div[draggable="true"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}))
    return transfer.getData('application/x-cursado-board-pdf')
  })
  await pencil.click()
  const name=library.getByRole('textbox',{name:'Nombre de Gu\u00eda de integrales.PDF',exact:true})
  await expect(name).toBeFocused()
  assert.equal(await library.getByText('Editar objeto',{exact:true}).count(),0)
  await name.fill('Guia renombrada.PDF')
  await name.press('Enter')
  await expect(name).toHaveCount(0,{timeout:30000})
  const renamed=library.getByRole('button',{name:'Renombrar Guia renombrada.PDF',exact:true}).first()
  await renamed.waitFor()
  const popupPromise=context.waitForEvent('page')
  const box=await renamed.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down()
  const popup=await popupPromise
  assert.equal(new URL(popup.url()).searchParams.get('materialId'),String(JSON.parse(oldReference).materialId))
  await page.mouse.up()
  await popup.close()
  assert.equal(await library.getByText('Editar objeto',{exact:true}).count(),0)
  const updatedReference=await renamed.evaluate(element=>{
    const transfer=new DataTransfer()
    element.closest('div[draggable="true"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}))
    return JSON.parse(transfer.getData('application/x-cursado-board-pdf'))
  })
  assert.equal(updatedReference.materialId,JSON.parse(oldReference).materialId)
  assert.equal(updatedReference.workspaceFileId,JSON.parse(oldReference).workspaceFileId)
  await board.locator('.app canvas').first().evaluate((canvas,data)=>{
    const transfer=new DataTransfer();transfer.setData('application/x-cursado-board-pdf',data)
    const rect=canvas.getBoundingClientRect()
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+250,clientY:rect.top+300}))
  },oldReference)
  await board.locator('.app canvas').first().click({position:{x:300,y:326}})
  await board.frameLocator('iframe[title="Lector de PDF de la pizarra"]').frameLocator('iframe[title^="Visor PDF:"]').locator('.page[data-page-number="1"] canvas').waitFor({timeout:30000})
})

test('the embedded library exposes Importantes and topic links return through the outer arrow',{timeout:120000},async t=>{
  const {page,errors}=await setup(t)
  await page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('board-library-test')
    const directory=await root.getDirectoryHandle('progreso')
    const handle=await directory.getFileHandle('importantes.json')
    const data=JSON.parse(await (await handle.getFile()).text())
    data.tasks[0].topics.push('Series');data.tasks[0].topicBoardIds.push('test-series')
    const writer=await handle.createWritable();await writer.write(JSON.stringify(data));await writer.close()
  })
  const board=await openTopic(page)
  await board.getByRole('button',{name:'Agregar imagen o PDF',exact:true}).click()
  await board.getByRole('button',{name:'▥ Biblioteca',exact:true}).click()
  await board.getByRole('button',{name:'Abrir mitad y mitad',exact:true}).click()
  const library=board.frameLocator('iframe[title="Biblioteca de Estudio"]')
  await library.getByRole('button',{name:'Importantes',exact:true}).click()
  const icon=library.getByLabel('Arrastrar pizarra Series',{exact:true})
  const data=await icon.evaluate(element=>{
    const transfer=new DataTransfer();element.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}))
    return transfer.getData('application/x-cursado-board-link')
  })
  assert.equal(JSON.parse(data).boardId,'local:important-test-series')
  await board.locator('.app canvas').first().evaluate((canvas,data)=>{
    const transfer=new DataTransfer();transfer.setData('application/x-cursado-board-link',data)
    const rect=canvas.getBoundingClientRect()
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+250,clientY:rect.top+300}))
  },data)
  await expect.poll(async()=>(await topicScene(page)).content.shapes?.length).toBe(1)
  await board.locator('.app canvas').first().click({position:{x:300,y:326}})
  await expect(board.locator('.app')).toHaveAttribute('data-board-id','local:important-test-series')
  await expect(board.locator('.app')).not.toHaveAttribute('inert')
  await expect.poll(()=>page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('board-library-test')
    const directory=await (await root.getDirectoryHandle('progreso')).getDirectoryHandle('pizarras')
    try{return JSON.parse(await (await (await directory.getFileHandle('test-series.json')).getFile()).text()).name}catch{return null}
  })).toBe('Series')
  const back=page.getByRole('button',{name:'Volver a Temas',exact:true})
  await back.click()
  await expect(back).toBeEnabled()
  await expect(board.locator('.app')).toHaveAttribute('data-board-id','local:important-test-integrales')
  await back.click()
  await expect(page.locator('iframe[title^="Pizarra de"]')).toHaveCount(0)
  assert.deepEqual(errors,[])
})
