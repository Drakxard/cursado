import {test,expect} from '@playwright/test'

async function saved(page){return page.evaluate(async()=>{
  const active=localStorage.getItem('pizarra_activa');if(!active)return null
  const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
  const record=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(active);request.onsuccess=()=>resolve(request.result)})
  db.close();return record?.draft??record?.content
})}
test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.route('**/biblioteca/publicador',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.goto('/pizarra/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await saved(page))?.camera).toBeDefined()
})
async function mark(page,x,y){
  await page.mouse.move(x-40,y-40);await page.keyboard.press('!')
  await page.mouse.move(x,y);await page.mouse.click(x,y)
}
test('markers follow the cursor, navigate cyclically, delete the selected target and persist',async({page})=>{
  await mark(page,250,250);await mark(page,650,350);await mark(page,1050,550)
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(3)
  const original=(await saved(page)).shapes
  expect(original.map(item=>[item.visualType,item.x,item.y])).toEqual([
    ['review-marker',222,222],['review-marker',622,322],['review-marker',1022,522],
  ])
  await page.keyboard.press('ArrowRight')
  await expect.poll(async()=>(await saved(page)).camera.x).toBe(433)
  await expect.poll(async()=>(await saved(page)).camera.y).toBe(200)
  await page.keyboard.press('ArrowRight')
  await expect.poll(async()=>(await saved(page)).camera.x).toBe(33)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async()=>(await saved(page)).camera.x).toBe(433)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async()=>(await saved(page)).camera.x).toBe(-367)
  expect((await saved(page)).shapes).toEqual(original)
  await page.keyboard.press('Delete')
  await expect.poll(async()=>(await saved(page)).shapes.map(item=>item.id)).toEqual(original.slice(0,2).map(item=>item.id))
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(3)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(2)
  await page.reload()
  await expect.poll(async()=>(await saved(page))?.shapes.length).toBe(2)
})
test('markers can be moved and duplicated, while exclamation marks in text stay text',async({page})=>{
  await page.keyboard.press('Control+!')
  expect((await saved(page)).shapes).toHaveLength(0)
  await mark(page,350,300)
  await page.mouse.move(350,300);await page.mouse.down();await page.mouse.move(450,400,{steps:5});await page.mouse.up()
  await expect.poll(async()=>(await saved(page)).shapes[0]?.x).toBe(422)
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+v')
  await expect.poll(async()=>(await saved(page)).shapes.length).toBe(2)
  expect((await saved(page)).shapes.every(item=>item.visualType==='review-marker')).toBe(true)
  await page.keyboard.press('t');await page.mouse.click(200,250)
  const field=page.locator('textarea.text-editor')
  await field.fill('Revisar');await field.press('!');await field.press('Escape')
  await expect.poll(async()=>(await saved(page)).texts[0]?.text).toBe('Revisar!')
  expect((await saved(page)).shapes).toHaveLength(2)
  await page.getByRole('button',{name:'Agregar nota adhesiva',exact:true}).click()
  const note=page.getByRole('textbox',{name:'Texto de la nota',exact:true})
  await note.fill('Importante');await note.press('!');await note.press('Escape')
  await expect.poll(async()=>(await saved(page)).shapes.find(item=>item.visualType==='sticky')?.note.text).toBe('Importante!')
  expect((await saved(page)).shapes.filter(item=>item.visualType==='review-marker')).toHaveLength(2)
  await page.screenshot({path:'test-results/review-markers.png'})
})
