import {test,expect} from '@playwright/test'

async function content(page){return page.evaluate(async()=>{
  const active=localStorage.getItem('pizarra_activa');if(!active)return null
  const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
  const board=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(active);request.onsuccess=()=>resolve(request.result)})
  db.close();return board?.draft??board?.content
})}

test('Escape commits new and existing canvas text, preserving undo, redo and reload',async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:503,body:'offline'}))
  await page.route('**/biblioteca/publicador',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.goto('/pizarra/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await content(page))?.camera).toBeDefined()
  await page.keyboard.press('t');await page.mouse.click(300,300)
  const editor=page.locator('textarea.text-editor')
  await editor.fill('Texto confirmado con Escape')
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect.poll(async()=>(await content(page)).texts[0]?.text).toBe('Texto confirmado con Escape')
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await content(page)).texts.length).toBe(0)
  await page.keyboard.press('Control+y')
  await expect.poll(async()=>(await content(page)).texts[0]?.text).toBe('Texto confirmado con Escape')
  await page.keyboard.press('v')
  await page.mouse.dblclick(310,310)
  await expect(editor).toHaveValue('Texto confirmado con Escape')
  await editor.fill('Edición conservada')
  await editor.press('Escape')
  await expect.poll(async()=>(await content(page)).texts[0]?.text).toBe('Edición conservada')
  expect((await content(page)).texts).toHaveLength(1)
  await page.reload()
  await expect.poll(async()=>(await content(page))?.texts[0]?.text).toBe('Edición conservada')
})
