import { test, expect } from '@playwright/test'
import { mindmapExample } from '../fixtures/mindmap.mjs'

async function content(page) {
  return page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    const board=await new Promise(resolve=>{const r=db.transaction('boards').objectStore('boards').get(localStorage.getItem('pizarra_activa'));r.onsuccess=()=>resolve(r.result)})
    db.close();return board?.draft??board?.content
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
  await editor.press('End');await editor.press('Enter');await editor.pressSequentially('Otra línea')
  await expect(editor).toBeVisible()
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect.poll(async()=>(await content(page)).texts[0].text).toBe(source+'\nOtra línea')
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).texts[0].text).toBe(source)
  await page.getByRole('button',{name:'Editar texto',exact:true}).click()
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

test('implication tree imports atomically, edits nodes in place and keeps geometric toolbar, rotation and reload',async({page})=>{
  await openLocal(page)
  await paste(page,mindmapExample)
  await expect.poll(async()=>(await content(page)).shapes?.length).toBe(25)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).shapes?.length).toBe(0)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await content(page)).shapes?.length).toBe(25)
  const root=(await content(page)).shapes.find(item=>item.label?.startsWith('Sistema Lineal'))
  const point=await center(page,root)
  await page.mouse.dblclick(point.x,point.y)
  const editor=page.getByRole('textbox',{name:'Texto de la figura',exact:true})
  await expect(editor).toHaveValue(root.label)
  await expect(page.getByRole('toolbar',{name:'Propiedades de la figura'})).toBeVisible()
  await page.evaluate(()=>{window.boardPaint.text=[]})
  await page.setViewportSize({width:1380,height:900})
  await expect(editor).toBeVisible()
  expect(await page.evaluate(label=>window.boardPaint.text.some(text=>label.includes(text)&&text.length>8),root.label)).toBe(false)
  await page.screenshot({path:'test-results/figura-edicion-sin-superposicion.png'})
  await editor.fill('Raíz editable');await editor.press('End');await editor.press('Enter');await editor.pressSequentially('Implicaciones')
  await expect(editor).toBeVisible();await editor.press('Escape')
  await expect.poll(async()=>(await content(page)).shapes.find(item=>item.id===root.id)?.label).toBe('Raíz editable\nImplicaciones')
  await page.mouse.dblclick(point.x,point.y)
  await expect(editor).toBeVisible()
  await editor.fill(String.raw`Sistema $X'=AX$`)
  await page.mouse.click(100,200)
  await expect.poll(()=>page.evaluate(()=>window.boardPaint.math),{timeout:20000}).toBeGreaterThan(0)
  await expect.poll(async()=>(await content(page)).shapes.find(item=>item.id===root.id)?.label).toBe(String.raw`Sistema $X'=AX$`)
  // Existing persisted figures use the same editor; exercise a rotated shape at a different zoom.
  await page.evaluate(async id=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    await new Promise(resolve=>{
      const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),r=store.get(localStorage.getItem('pizarra_activa'))
      r.onsuccess=()=>{const board=r.result,data=board.draft??board.content,node=data.shapes.find(item=>item.id===id);node.rotation=.3;data.camera={zoom:.8,x:400-node.x*.8,y:300-node.y*.8};store.put(board)}
      tx.oncomplete=resolve
    });db.close()
  },root.id)
  await page.reload()
  await expect.poll(async()=>(await content(page))?.shapes?.length).toBe(25)
  const rotated=(await content(page)).shapes.find(item=>item.id===root.id),position=await center(page,rotated)
  await page.mouse.dblclick(position.x,position.y)
  await expect(editor).toHaveValue(String.raw`Sistema $X'=AX$`)
  await expect(editor).toHaveCSS('transform',/matrix/)
  await page.screenshot({path:'test-results/figura-editor-rotacion-zoom.png'})
  await editor.press('Escape')
  await paste(page,'@startmindmap\n* A\n*** Nivel inválido\n@endmindmap')
  await expect(page.getByRole('status')).toContainText('Se pegó como texto')
  await expect.poll(async()=>(await content(page)).shapes.length).toBe(25)
  await expect.poll(async()=>(await content(page)).texts?.length).toBe(1)
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
