import {test,expect} from '@playwright/test'

async function saved(page) {
  return page.evaluate(async()=>{
    const active=localStorage.getItem('pizarra_activa')
    if(!active)return null
    const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
    const value=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(active);request.onsuccess=()=>resolve(request.result)})
    db.close();return value?.content
  })
}
const reference={materialId:41,subjectId:'calculo3',fileName:'Guía.PDF',workspaceFileId:'workspace://teoria/calculo3/guia.pdf'}
async function drop(page,x=220,y=300,value=reference) {
  await page.locator('.app canvas').first().evaluate((canvas,{reference,x,y})=>{
    const dataTransfer=new DataTransfer();dataTransfer.setData('application/x-cursado-board-pdf',JSON.stringify(reference))
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX:x,clientY:y}))
  },{reference:value,x,y})
}

async function closeReader(page) {
  const frame=page.frameLocator('.board-pdf-reader[aria-hidden="false"] iframe')
  await frame.locator('button').focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
}
test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{}}))
  await page.route('**/biblioteca/pizarra?**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><button id="escape">Cerrar con Escape</button><script>
    const p=new URLSearchParams(location.search),session=p.get('session'),boardId=p.get('boardId'),reader=p.get('mode')==='reader';
    addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data.session!==session||e.data.boardId!==boardId)return;
      if(e.data.type==='board-library:init'){document.body.dataset.initialized='yes';if(reader)parent.postMessage({type:'board-library:reader-rendered',session,boardId},location.origin);}
      if(e.data.type==='board-library:escape-reader')parent.postMessage({type:'board-library:reader-closed',session,boardId},location.origin);
    });
    addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage({type:reader?'board-library:reader-closed':'board-library:escape',session,boardId},location.origin)});
    parent.postMessage({type:'board-library:ready',session,boardId},location.origin);
    <\/script>`}))
  await page.goto('/pizarra/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await saved(page))?.camera).toBeDefined()
})
test('PDF shortcuts persist, move, undo, duplicate and delete without importing PDF pages',async({page})=>{
  await drop(page)
  await expect.poll(async()=>(await saved(page))?.shapes?.length).toBe(1)
  expect((await saved(page)).shapes[0]).toMatchObject({visualType:'pdf-shortcut',label:'Guía',pdfReference:reference})
  expect((await saved(page)).media).toEqual([])
  await page.mouse.move(270,326);await page.mouse.down();await page.mouse.move(350,366,{steps:8});await page.mouse.up()
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await expect.poll(async()=>(await saved(page)).shapes[0].x).toBe(300)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await saved(page)).shapes[0].x).toBe(220)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await saved(page)).shapes[0].x).toBe(300)
  await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.keyboard.press('Control+v')
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(2)
  expect((await saved(page)).shapes.every(shape=>JSON.stringify(shape.pdfReference)===JSON.stringify(reference))).toBe(true)
  await page.keyboard.press('Delete')
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(1)
  await page.reload()
  await expect.poll(async()=>(await saved(page))?.shapes?.length).toBe(1)
  expect((await saved(page)).shapes[0].pdfReference).toEqual(reference)
})
test('Escape closes menus before changing tools, closes the split and returns from fullscreen PDF without changing the board',async({page})=>{
  await page.keyboard.press('Escape')
  await expect(page.locator('.app')).toHaveAttribute('data-tool','select')
  await drop(page)
  await page.getByRole('button',{name:'Agregar imagen o PDF',exact:true}).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'▤ PDF',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Agregar imagen o PDF',exact:true}).click()
  await page.getByRole('button',{name:'▥ Biblioteca',exact:true}).click()
  await page.getByRole('button',{name:'Abrir mitad y mitad',exact:true}).click()
  const library=page.frameLocator('iframe[title="Biblioteca de Estudio"]')
  await expect(library.locator('body')).toHaveAttribute('data-initialized','yes')
  const before=await saved(page)
  await expect(page.locator('.board-pdf-reader[aria-hidden="true"] iframe')).toHaveCount(1)
  await expect(page.frameLocator('iframe[title="Lector de PDF de la pizarra"]').locator('body')).toHaveAttribute('data-initialized','yes')
  await page.frameLocator('iframe[title="Lector de PDF de la pizarra"]').locator('body').evaluate(body=>body.dataset.preloaded='yes')
  await page.mouse.click(270,326)
  const reader=page.frameLocator('iframe[title="Lector de PDF de la pizarra"]')
  await expect(reader.locator('body')).toHaveAttribute('data-initialized','yes')
  await page.evaluate(()=>{
    const params=new URL(document.querySelector('.board-pdf-reader iframe').src).searchParams
    window.postMessage({type:'board-library:reader-closed',session:params.get('session'),boardId:params.get('boardId')},location.origin)
  })
  await reader.locator('body').evaluate(()=>parent.postMessage({type:'board-library:reader-closed',session:'wrong',boardId:new URLSearchParams(location.search).get('boardId')},location.origin))
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(1)
  const bounds=await page.locator('.board-pdf-reader[aria-hidden="false"]').boundingBox()
  expect(bounds.width).toBe(1366)
  await reader.locator('button').focus();await page.keyboard.press('Escape')
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await expect(reader.locator('body')).toHaveAttribute('data-preloaded','yes')
  await page.mouse.click(270,326)
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(1)
  await expect(reader.locator('body')).toHaveAttribute('data-preloaded','yes')
  await reader.locator('button').focus();await page.keyboard.press('Escape')
  await expect(page.locator('.app')).toHaveAttribute('data-library-split','true')
  expect((await saved(page)).camera).toMatchObject({x:before.camera.x,y:before.camera.y,zoom:before.camera.zoom})
  await library.locator('button').focus();await page.keyboard.press('Escape')
  await expect(page.locator('.app')).toHaveAttribute('data-library-split','false')
})

test('a single PDF shortcut can be pinned, opened from the dock, located by long press and unpinned',async({page})=>{
  await drop(page)
  await expect.poll(async()=>(await saved(page))?.shapes?.length).toBe(1)
  await page.mouse.click(270,326)
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(1)
  await closeReader(page)
  await expect(page.locator('.math-dock .pdf-pin-control')).toHaveCount(1)
  await expect(page.locator('.pdf-pin-control')).toHaveCSS('position','static')
  await page.getByRole('button',{name:'Fijar PDF Guía',exact:true}).click()
  const pinned=page.getByRole('button',{name:'Abrir PDF fijado Guía',exact:true})
  await expect(pinned).toBeVisible()
  await expect.poll(async()=>(await saved(page)).shapes[0]?.pdfPinned).toBe(true)
  await pinned.click()
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(1)
  await closeReader(page)
  await page.reload()
  await expect(pinned).toBeVisible()
  await page.mouse.move(100,700)
  await page.mouse.wheel(0,900)
  await expect.poll(async()=>(await saved(page)).camera.y).toBeLessThan(-500)
  const button=await pinned.boundingBox()
  await page.mouse.move(button.x+button.width/2,button.y+button.height/2)
  await page.mouse.down()
  await expect(page.getByRole('button',{name:'Desfijar PDF Guía',exact:true})).toBeInViewport()
  await page.mouse.up()
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await expect.poll(async()=>(await saved(page)).camera.y).toBeGreaterThan(-500)
  await page.getByRole('button',{name:'Desfijar PDF Guía',exact:true}).click()
  await expect(pinned).toHaveCount(0)
  await expect.poll(async()=>(await saved(page)).shapes[0]?.pdfPinned).toBe(false)
  await page.keyboard.press('Control+z')
  await expect(pinned).toBeVisible()
  await page.setViewportSize({width:390,height:667})
  await expect(pinned).toBeInViewport()
  await page.screenshot({path:'test-results/pdf-pinned-mobile.png'})
})

test('multiple selected PDF shortcuts move together, do not open a reader, and cannot be pinned as a selection',async({page})=>{
  await drop(page)
  await drop(page,220,400,{...reference,materialId:42,fileName:'Otra.pdf'})
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(2)
  await page.keyboard.press('Control+a')
  await expect(page.locator('.pdf-pin-control')).toHaveCount(0)
  const before=(await saved(page)).shapes
  await page.mouse.move(270,326);await page.mouse.down();await page.mouse.move(350,366,{steps:8});await page.mouse.up()
  await expect.poll(async()=>(await saved(page)).shapes.map(item=>[item.x,item.y])).toEqual(before.map(item=>[item.x+80,item.y+40]))
  await expect(page.locator('.board-pdf-reader[aria-hidden="false"]')).toHaveCount(0)
  await expect(page.locator('.pdf-pin-control')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await saved(page)).shapes.map(item=>[item.x,item.y])).toEqual(before.map(item=>[item.x,item.y]))
})

test('five visited PDFs retain their iframe documents and reading state while cycling through them',async({page})=>{
  for(let i=0;i<5;i++)await drop(page,220,180+i*90,{...reference,materialId:41+i,fileName:`PDF ${i+1}.pdf`})
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(5)
  for(let i=0;i<5;i++){
    await page.mouse.click(270,206+i*90)
    const frame=page.frameLocator('.board-pdf-reader[aria-hidden="false"] iframe')
    await expect(frame.locator('body')).toHaveAttribute('data-initialized','yes')
    await frame.locator('body').evaluate((body,i)=>{body.dataset.readingState=`page-${i+10};zoom-150`},i)
    await closeReader(page)
  }
  await expect(page.locator('.board-pdf-reader iframe')).toHaveCount(5)
  for(let i=0;i<5;i++){
    await page.mouse.click(270,206+i*90)
    const frame=page.frameLocator('.board-pdf-reader[aria-hidden="false"] iframe')
    await expect(frame.locator('body')).toHaveAttribute('data-reading-state',`page-${i+10};zoom-150`)
    if(i===0){
      await page.frameLocator('.board-pdf-reader iframe[src*="materialId=42"]').locator('body').evaluate(()=>{
        const params=new URLSearchParams(location.search)
        parent.postMessage({type:'board-library:reader-closed',session:params.get('session'),boardId:params.get('boardId')},location.origin)
      })
      await expect(page.locator('.board-pdf-reader[aria-hidden="false"] iframe')).toHaveAttribute('src',/materialId=41$/)
    }
    await closeReader(page)
  }
})

test('reader retention is bounded and evicts the least recently visited PDF',async({page})=>{
  test.setTimeout(60000)
  for(let i=0;i<9;i++)await drop(page,220+(i%2)*480,180+Math.floor(i/2)*90,{...reference,materialId:41+i,fileName:`PDF ${i+1}.pdf`})
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(9)
  const open=async i=>{
    await page.mouse.click(270+(i%2)*480,206+Math.floor(i/2)*90)
    await expect(page.locator('.board-pdf-reader[aria-hidden="false"] iframe')).toHaveAttribute('src',new RegExp(`materialId=${41+i}$`))
    await closeReader(page)
  }
  for(let i=0;i<9;i++)await open(i)
  const ids=()=>page.locator('.board-pdf-reader iframe').evaluateAll(frames=>frames.map(frame=>Number(new URL(frame.src).searchParams.get('materialId'))).sort((a,b)=>a-b))
  await expect.poll(ids).toEqual([42,43,44,45,46,47,48,49])
  await open(1)
  await open(0)
  await expect.poll(ids).toEqual([41,42,44,45,46,47,48,49])
})
