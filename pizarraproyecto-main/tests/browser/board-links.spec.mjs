import {test,expect} from '@playwright/test'
async function record(page,id){return page.evaluate(async id=>{
  id=id||localStorage.getItem('pizarra_activa');if(!id)return null
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const result=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(id||localStorage.getItem('pizarra_activa'));r.onsuccess=()=>resolve(r.result)})
  db.close();return result
},id)}
async function drop(page,type,value,x=250,y=300){await page.locator('.app canvas').first().evaluate((canvas,{type,value,x,y})=>{
  const transfer=new DataTransfer();transfer.setData(type,JSON.stringify(value))
  canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:x,clientY:y}))
},{type,value,x,y})}
test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.route('**/biblioteca/publicador',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.goto('/pizarra/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await record(page))?.content?.camera).toBeDefined()
})
async function seed(page){return page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
  const origin=localStorage.getItem('pizarra_activa')
  const source=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(origin);r.onsuccess=()=>resolve(r.result)})
  await new Promise((resolve,reject)=>{const tx=db.transaction('boards','readwrite');for(const id of ['local:board-b','local:board-c'])tx.objectStore('boards').put({...source,key:id,id,name:id,content:{...source.content,shapes:[],camera:{x:0,y:0,zoom:1}}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})
  db.close();return origin
})}
test('linked boards navigate A to B to C and return to the original viewport',async({page})=>{
  const origin=await seed(page)
  await drop(page,'application/x-cursado-board-link',{boardId:'local:board-b',name:'B'})
  await expect.poll(async()=>(await record(page)).content.shapes.length).toBe(1)
  await page.mouse.click(300,326)
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe('local:board-b')
  await expect(page.getByRole('button',{name:'Volver a la pizarra de origen'})).toBeVisible()
  await drop(page,'application/x-cursado-board-link',{boardId:'local:board-c',name:'C'})
  await expect.poll(async()=>(await record(page)).content.shapes.length).toBe(1)
  await page.mouse.click(300,326)
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe('local:board-c')
  await page.getByRole('button',{name:'Volver a la pizarra de origen'}).click()
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe('local:board-b')
  await page.getByRole('button',{name:'Volver a la pizarra de origen'}).click()
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(origin)
  await expect(page.getByRole('button',{name:'Volver a la pizarra de origen'})).toHaveCount(0)
  expect((await record(page)).content.camera).toMatchObject({x:0,y:0,zoom:1})
  await page.reload();await expect(page.locator('.app')).toBeVisible()
  expect((await record(page)).content.shapes[0].boardReference.boardId).toBe('local:board-b')
})
test('missing targets and save errors keep the original board open',async({page})=>{
  const origin=await seed(page)
  await drop(page,'application/x-cursado-board-link',{boardId:'local:missing',name:'Falta'})
  await expect.poll(async()=>(await record(page)).content.shapes.length).toBe(1)
  await page.mouse.click(300,326)
  await expect(page.getByRole('alert')).toContainText('eliminada')
  expect(await page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(origin)
  await page.getByRole('button',{name:'Cerrar',exact:true}).click()
  await drop(page,'application/x-cursado-board-link',{boardId:'local:board-b',name:'B'},600,300)
  await expect.poll(async()=>(await record(page)).content.shapes.length).toBe(2)
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;window.restorePut=()=>{IDBObjectStore.prototype.put=original};IDBObjectStore.prototype.put=function(...args){if(this.name==='boards')throw new Error('Fallo de guardado simulado');return original.apply(this,args)}})
  await page.keyboard.press('!');await page.mouse.click(850,450)
  await page.mouse.click(650,326)
  await expect(page.getByRole('alert')).toContainText('guardar')
  expect(await page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe(origin)
  await page.evaluate(()=>window.restorePut())
  await page.getByRole('button',{name:'Cerrar',exact:true}).click()
  await page.mouse.click(650,326)
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('pizarra_activa'))).toBe('local:board-b')
})

test('a countdown follows the original task and becomes unavailable after deletion',async({page})=>{
  await page.evaluate(async()=>{
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('countdown-test',{create:true})
    const dir=await root.getDirectoryHandle('progreso',{create:true})
    const key=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
    window.writeCountdown=async days=>{
      const now=new Date(),due=new Date(now);due.setDate(due.getDate()+days)
      const tasks=days===null?[]:[{id:'exam',text:'Parcial',startDate:key(now),dueDate:key(due),url:'',topics:[]}]
      const writer=await (await dir.getFileHandle('importantes.json',{create:true})).createWritable();await writer.write(JSON.stringify({version:1,tasks}));await writer.close()
      window.dispatchEvent(new Event('focus'))
    }
    await window.writeCountdown(4)
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('local-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    await new Promise(resolve=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({id:'root-handle',handle:root});tx.oncomplete=resolve});db.close()
  })
  await drop(page,'application/x-cursado-important',{taskId:'exam'})
  await expect.poll(async()=>(await record(page)).content.shapes[0]?.importantTaskId).toBe('exam')
  const pixel=()=>page.locator('.app canvas').first().evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(270,315,1,1).data).slice(0,3))
  await expect.poll(async()=>{const [r,g]=await pixel();return g>r}).toBe(true)
  await page.evaluate(()=>window.writeCountdown(1))
  await expect.poll(async()=>{const [r,g]=await pixel();return r>g}).toBe(true)
  await page.evaluate(()=>window.writeCountdown(null))
  await expect.poll(async()=>{const [r,g,b]=await pixel();return b>g&&g>r}).toBe(true)
  const shape=(await record(page)).content.shapes[0]
  expect(shape.visualType).toBe('important-countdown');expect(shape.dueDate).toBeUndefined()
})
