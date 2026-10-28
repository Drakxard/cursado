import { test, expect } from '@playwright/test'
import { mindmapExample } from '../fixtures/mindmap.mjs'
import { writeFile } from 'node:fs/promises'

async function content(page) {
  return page.evaluate(async()=>{
    const active=localStorage.getItem('pizarra_activa');if(!active)return null
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const board=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(active);r.onsuccess=()=>resolve(r.result)})
    db.close()
    const data=board?.draft??board?.content
    // Windows Clipboard adds CRLF; textarea editing normalizes it back to LF.
    for(const item of data?.texts??[])item.text=item.text.replace(/\r\n/g,'\n')
    return data
  })
}
async function openLocal(page) {
  await page.context().grantPermissions(['clipboard-read','clipboard-write'])
  await page.addInitScript(()=>{
    window.boardPaint={text:[],math:0}
    const fill=CanvasRenderingContext2D.prototype.fillText,draw=CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.isConnected)window.boardPaint.text.push(text);return fill.call(this,text,...args)}
    CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(this.canvas.isConnected&&image?.dataset?.boardMath)window.boardPaint.math++;return draw.call(this,image,...args)}
  })
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.route('**/biblioteca/publicador',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.goto('/pizarra/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await content(page))?.camera).toBeDefined()
  await page.keyboard.press('v')
}
async function paste(page,text) {
  await page.evaluate(text=>navigator.clipboard.writeText(text),text)
  await page.locator('canvas[tabindex]').focus()
  await page.keyboard.press('Control+v')
}
async function center(page,item) {
  const {camera}=await content(page)
  return {x:(item.x+item.width/2)*camera.zoom+camera.x,y:(item.y+item.height/2)*camera.zoom+camera.y}
}

test('clipboard text and KaTeX stay editable; Enter, Escape, outside, menu and undo preserve text',async({page})=>{
  await openLocal(page)
  const source=String.raw`Resultado $\frac{1}{2}$
Segunda línea`
  await paste(page,source)
  await expect.poll(async()=>(await content(page)).texts?.[0]?.text).toBe(source)
  await expect.poll(()=>page.evaluate(()=>window.boardPaint.math),{timeout:20000}).toBeGreaterThan(0)
  await page.getByRole('button',{name:'Editar texto',exact:true}).click()
  const editor=page.locator('textarea.text-editor')
  await expect(editor).toHaveValue(source)
  await editor.press('Control+End');await editor.press('Enter');await editor.pressSequentially('Otra línea')
  await expect(editor).toBeVisible()
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect.poll(async()=>(await content(page)).texts[0].text).toBe(source+'\nOtra línea')
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).texts[0].text).toBe(source)
  const restoredText=(await content(page)).texts[0],view=(await content(page)).camera
  await page.mouse.dblclick(restoredText.x*view.zoom+view.x+10,restoredText.y*view.zoom+view.y+10)
  await editor.fill('Confirmado fuera')
  await page.mouse.click(110,220)
  await expect.poll(async()=>(await content(page)).texts[0].text).toBe('Confirmado fuera')
  await page.evaluate(()=>navigator.clipboard.writeText('Texto desde menú'))
  await page.mouse.click(120,240,{button:'right'})
  await page.getByRole('menuitem',{name:/^Pegar/}).click()
  await expect.poll(async()=>(await content(page)).texts?.length).toBe(2)
  await page.reload()
  await expect.poll(async()=>(await content(page))?.texts?.map(item=>item.text)).toEqual(['Confirmado fuera','Texto desde menú'])
  await paste(page,'A\tB\n1\t2')
  await expect.poll(async()=>(await content(page)).tables?.length).toBe(1)
})

test('PlantUML paste creates one local image, supports undo, move and reload',async({page})=>{
  const engineRequests=[]
  page.on('request',request=>{if(/plantuml.*\.js|viz-global.*\.js/.test(request.url()))engineRequests.push(request.url())})
  await openLocal(page)
  expect(engineRequests).toHaveLength(0)
  await paste(page,mindmapExample)
  await expect.poll(async()=>(await content(page)).media?.length,{timeout:30000}).toBe(1)
  expect((await content(page)).shapes??[]).toHaveLength(0)
  expect((await content(page)).texts??[]).toHaveLength(0)
  expect(engineRequests.length).toBeGreaterThan(0)
  expect(engineRequests.every(url=>new URL(url).origin===new URL(page.url()).origin)).toBe(true)
  const image=(await content(page)).media[0]
  expect(image.kind).toBe('image')
  expect(image.name).toContain('PlantUML')
  const asset=await page.evaluate(async id=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const record=await new Promise(resolve=>{const r=db.transaction('assets').objectStore('assets').get(`device:${id}`);r.onsuccess=()=>resolve(r.result)})
    db.close();return {type:record.type,size:record.size}
  },image.assetId)
  expect(asset.type).toBe('image/png')
  expect(asset.size).toBeGreaterThan(1000)
  await page.keyboard.press('Escape')
  await page.screenshot({path:'test-results/plantuml-imagen.png'})
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).media?.length).toBe(0)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await content(page)).media?.length).toBe(1)
  const point=await center(page,image)
  await page.mouse.move(point.x,point.y)
  await page.mouse.down();await page.mouse.move(point.x+50,point.y+35,{steps:8});await page.mouse.up()
  await expect.poll(async()=>(await content(page)).media[0].x).not.toBe(image.x)
  const before=(await content(page)).media
  await page.reload()
  await expect.poll(async()=>(await content(page))?.media).toEqual(before)
  await paste(page,'@startmindmap\n* A\n*** Nivel incorrecto\n@endmindmap')
  await expect(page.getByRole('status')).toContainText('Se peg')
  await expect.poll(async()=>(await content(page)).texts?.length).toBe(1)
  expect((await content(page)).media).toHaveLength(1)
  expect((await content(page)).shapes??[]).toHaveLength(0)
})

test('PlantUML PNG includes KaTeX formulas on their own rows',async({page})=>{
  await openLocal(page)
  await page.evaluate(()=>{
    window.plantumlRows=[]
    new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes){
        if(!(node instanceof HTMLElement)||!node.dataset.plantumlLabel)return
        window.plantumlRows.push(Array.from(node.children,row=>({
          kind:row.dataset.plantumlRow,math:!!row.querySelector('.katex-display'),
          top:row.getBoundingClientRect().top,bottom:row.getBoundingClientRect().bottom,
        })))
      }
    }).observe(document.body,{childList:true})
  })
  await paste(page,String.raw`@startmindmap
* Sistema homogéneo $X'=AX$ y su solución
** Propuesta: <latex>X(t)=Ke^{\lambda t}</latex>
** Fracción \(\frac{1}{2}\) y matriz $$\begin{pmatrix}1&2\\0&3\end{pmatrix}$$
** Fórmula inválida $\invalid{a}$
@endmindmap`)
  await expect.poll(async()=>(await content(page)).media?.length,{timeout:30000}).toBe(1)
  const rows=await page.evaluate(()=>window.plantumlRows)
  expect(rows).toHaveLength(4)
  expect(rows[0].map(row=>row.kind)).toEqual(['text','math','text'])
  expect(rows.flat().filter(row=>row.math)).toHaveLength(4)
  for(const label of rows)for(let i=1;i<label.length;i++)expect(label[i].top).toBeGreaterThanOrEqual(label[i-1].bottom)
  expect((await content(page)).shapes??[]).toHaveLength(0)
  expect((await content(page)).texts??[]).toHaveLength(0)
  const bytes=await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const id=localStorage.getItem('pizarra_activa')
    const board=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(id);r.onsuccess=()=>resolve(r.result)})
    const image=(board.draft??board.content).media[0]
    const blob=await new Promise(resolve=>{const r=db.transaction('assets').objectStore('assets').get(`device:${image.assetId}`);r.onsuccess=()=>resolve(r.result)})
    db.close();return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await writeFile('test-results/plantuml-katex.png',Buffer.from(bytes))
})

for(const [name,source,video] of [
  ['YouTube','https://youtu.be/dQw4w9WgXcQ',true],
  ['URL with math',String.raw`Texto $x^2$ https://example.com`,false],
  ['URL in mindmap','@startmindmap\n* Raíz https://example.com\n** $x^2$\n@endmindmap',false],
])test(`URL keeps previous paste behavior: ${name}`,async({page})=>{
  await openLocal(page);await paste(page,source)
  if(video)await expect.poll(async()=>(await content(page)).videos?.length).toBe(1)
  else await expect.poll(async()=>(await content(page)).texts?.[0]?.text).toBe(source)
  expect((await content(page)).shapes??[]).toHaveLength(0)
  expect(await page.evaluate(()=>window.boardPaint.math)).toBe(0)
})
