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
async function drop(page,x=220,y=300) {
  await page.locator('.app canvas').first().evaluate((canvas,{reference,x,y})=>{
    const dataTransfer=new DataTransfer();dataTransfer.setData('application/x-cursado-board-pdf',JSON.stringify(reference))
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX:x,clientY:y}))
  },{reference,x,y})
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
