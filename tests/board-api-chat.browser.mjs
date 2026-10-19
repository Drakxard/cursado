import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

test('InScreen web overlay: focus, image toggle, formulas, retries, keyboard and cancellation', {timeout:60000}, async t=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Chat from './components/BoardApiChat';const root=createRoot(document.getElementById('root'));window.openChat=()=>root.render(React.createElement(Chat,{image:'data:image/png;base64,YQ==',onClose:()=>{root.render(null);document.querySelector('canvas').focus()}}));window.openChat();`,resolveDir:process.cwd()+'/pizarraproyecto-main/src',loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'services',setup(builder){
    builder.onResolve({filter:/local-workspace-client$/},()=>({path:'services',namespace:'fixture'}))
    builder.onResolve({filter:/topicWorkspace$/},()=>({path:'workspace',namespace:'fixture'}))
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='services'?`export const loadWorkspaceHandle=async()=>({});export const loadServicesFile=async()=>({inscreenToken:'encrypted-token'});`:`export const getTopicWorkspaceRoot=()=>null;`,loader:'js'}))
  }}]})
  const browser=await chromium.launch({headless:true,channel:process.env.CI?undefined:'chrome'})
  t.after(()=>browser.close())
  const page=await browser.newPage(), calls=[]
  await page.route('http://board.test/',route=>route.fulfill({contentType:'text/html',body:'<canvas tabindex="-1"></canvas><div id="root"></div>'}))
  let fail=false,hold=false
  await page.route('**/api/board-chat',async route=>{
    calls.push({body:route.request().postDataJSON(),headers:route.request().headers()})
    if(hold)return
    await route.fulfill({status:fail?428:200,json:fail?{error:'Configurá GPT-5 mini en la estrella'}:{answer:'**Resultado** \\( x^2 \\) <img src=x onerror=alert(1)>'}})
  })
  await page.goto('http://board.test/')
  await page.addStyleTag({content:await readFile('pizarraproyecto-main/src/components/BoardApiChat.css','utf8')})
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  const input=page.getByRole('textbox',{name:'Pregunta para GPT-5 mini'})
  await expect(input).toBeFocused()
  await input.press('Enter');assert.equal(calls.length,0)
  await page.keyboard.type('Explicame < esto');await input.press('Enter')
  await expect(page.locator('.katex')).toHaveCount(1)
  assert.equal(await page.locator('.board-api-chat-answer img').count(),0)
  assert.equal(calls[0].body.image,'data:image/png;base64,YQ==')
  assert.equal(calls[0].headers['x-inscreen-config-token'],'encrypted-token')
  await expect(input).toHaveValue('');await expect(input).toBeFocused()
  await page.getByRole('switch').uncheck()
  fail=true;await input.fill('Otra duda');await input.press('Enter')
  await expect(page.getByRole('alert')).toContainText('estrella')
  await expect(input).toHaveValue('Otra duda')
  assert.equal(calls[1].body.image,undefined);assert.equal(calls[1].body.context.length,2)
  fail=false;await input.press('Enter');await expect(input).toHaveValue('')
  const aborted=page.waitForEvent('requestfailed',request=>request.url().endsWith('/api/board-chat'))
  hold=true;await input.fill('Pendiente');await input.press('Enter')
  await expect(page.getByRole('status')).toBeVisible()
  const count=calls.length;await input.press('Enter');assert.equal(calls.length,count)
  await input.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.match((await aborted).failure().errorText,/ABORTED/i)
  await expect(page.locator('canvas')).toBeFocused()
})
