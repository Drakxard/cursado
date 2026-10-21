import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'

// Playwright's US keyboard map cannot type this Spanish-layout key.
async function pressAudio(page,options={}){
  const session=await page.context().newCDPSession(page)
  await session.send('Input.dispatchKeyEvent',{type:'keyDown',key:'¿',code:'BracketRight',windowsVirtualKeyCode:221,...options})
  await session.send('Input.dispatchKeyEvent',{type:'keyUp',key:'¿',code:'BracketRight',windowsVirtualKeyCode:221})
  await session.detach()
}

async function saved(page){return page.evaluate(async()=>{
  const active=localStorage.getItem('pizarra_activa');if(!active)return null
  const db=await new Promise(resolve=>{const request=indexedDB.open('pizarra-dispositivo',1);request.onsuccess=()=>resolve(request.result)})
  const result=await new Promise(resolve=>{const request=db.transaction('boards').objectStore('boards').get(active);request.onsuccess=()=>resolve(request.result?.content)})
  db.close();return result
})}
test.beforeEach(async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({status:401,json:{}}))
  await page.route('**/biblioteca/publicador',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Publisher fixture</title>'}))
  await page.addInitScript(()=>{
    window.audioStreams=[];window.audioPlayers=[]
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      if(window.denyAudio)throw new DOMException('Micrófono denegado','NotAllowedError')
      const context=new AudioContext(),oscillator=context.createOscillator(),target=context.createMediaStreamDestination()
      oscillator.connect(target);oscillator.start();await context.resume()
      window.audioStreams.push(target.stream)
      for(const track of target.stream.getTracks()){
        const stop=track.stop.bind(track);track.stop=()=>{stop();oscillator.stop();void context.close()}
      }
      return target.stream
    }})
    const AudioOriginal=window.Audio
    window.Audio=function(...args){const player=new AudioOriginal(...args);window.audioPlayers.push(player);return player}
    const put=IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put=function(value,...args){
      if(window.failAudioSave&&this.name==='assets'&&value instanceof Blob&&value.type.startsWith('audio/'))throw new DOMException('Sin espacio','QuotaExceededError')
      return put.call(this,value,...args)
    }
  })
  await page.goto('/pizarra/')
  await page.getByRole('button',{name:'Abrir privadas y copias de este dispositivo'}).click()
  await expect.poll(async()=>(await saved(page))?.camera).toBeDefined()
})

async function record(page){
  await page.mouse.move(300,300);await pressAudio(page)
  await expect(page.getByRole('status').filter({hasText:'Grabando'})).toBeVisible()
  await page.mouse.move(450,350);await page.mouse.click(450,350)
  await expect(page.locator('.audio-note-status')).toContainText('0:01')
  await pressAudio(page)
  await expect(page.locator('.audio-note-status')).toHaveCount(0)
  await expect.poll(async()=>(await saved(page)).media.length).toBe(1)
  return (await saved(page)).media[0]
}
test('audio records at the cursor, moves, plays, pauses, persists, duplicates and deletes',async({page})=>{
  const item=await record(page)
  expect(item).toMatchObject({kind:'audio',x:422,y:322,width:56,height:56})
  expect(item.mimeType).toContain('audio/webm');expect(item.durationMs).toBeGreaterThan(500)
  await expect(page.getByText('Recortar imagen',{exact:true})).toHaveCount(0)
  await page.mouse.move(450,350);await page.mouse.down();await page.mouse.move(550,400,{steps:5});await page.mouse.up()
  await expect.poll(async()=>(await saved(page)).media[0].x).toBe(522)
  expect(await page.evaluate(()=>audioPlayers.length)).toBe(0)
  await page.mouse.click(550,400)
  await expect(page.getByRole('button',{name:'Pausar nota de audio',exact:true})).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  expect((await saved(page)).media[0].x).toBe(522)
  await page.mouse.click(550,400)
  await expect(page.getByRole('button',{name:'Reproducir nota de audio',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>audioPlayers[0].paused)).toBe(true)
  await page.reload()
  await expect.poll(async()=>(await saved(page))?.media[0]?.kind).toBe('audio')
  await page.getByRole('button',{name:'Reproducir nota de audio',exact:true}).click()
  await expect(page.getByRole('button',{name:'Pausar nota de audio',exact:true})).toBeVisible()
  await page.keyboard.press('Delete')
  await expect.poll(async()=>(await saved(page)).media.length).toBe(0)
  expect(await page.evaluate(()=>audioPlayers[0].paused)).toBe(true)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await saved(page)).media.length).toBe(1)
  await page.mouse.move(550,400);await page.mouse.down();await page.mouse.move(560,400);await page.mouse.up()
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+v')
  await expect.poll(async()=>(await saved(page)).media.length).toBe(2)
  expect((await saved(page)).media.map(note=>note.assetId)).toEqual([item.assetId,item.assetId])
  await page.screenshot({path:'test-results/audio-notes.png'})
})
test('permission failure, Escape, retry and text fields do not leave a microphone running',async({page})=>{
  await pressAudio(page,{modifiers:2});await pressAudio(page,{autoRepeat:true})
  await expect(page.locator('.audio-note-draft')).toHaveCount(0)
  await page.evaluate(()=>window.denyAudio=true);await pressAudio(page)
  await expect(page.getByRole('alert')).toContainText('denegado')
  await page.getByRole('button',{name:'Cerrar',exact:true}).click()
  await page.evaluate(()=>window.denyAudio=false)
  await pressAudio(page);await expect(page.locator('.audio-note-status')).toContainText('Grabando')
  await page.keyboard.press('Escape');await expect(page.locator('.audio-note-draft')).toHaveCount(0)
  expect(await page.evaluate(()=>audioStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true)
  await page.evaluate(()=>window.failAudioSave=true)
  await pressAudio(page);await expect(page.locator('.audio-note-status')).toContainText('0:01');await pressAudio(page)
  await expect(page.getByRole('alert')).toContainText('Sin espacio')
  expect(await page.evaluate(()=>audioStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true)
  await page.evaluate(()=>window.failAudioSave=false);await page.getByRole('button',{name:'Reintentar guardado'}).click()
  await expect(page.locator('.audio-note-status')).toHaveCount(0)
  expect((await saved(page)).media).toHaveLength(1)
  await page.getByRole('button',{name:'Buscar texto en la pizarra'}).click()
  await page.getByRole('textbox',{name:'Texto para buscar'}).fill('¿')
  await pressAudio(page)
  await expect(page.locator('.audio-note-draft')).toHaveCount(0)
})
test('backup contains the original audio bytes and MIME',async({page})=>{
  const item=await record(page)
  await page.getByRole('button',{name:/Mi pizarra privada/}).first().click()
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar respaldo',exact:true}).click()
  const backup=JSON.parse(await readFile(await (await download).path(),'utf8'))
  expect(backup.content.media[0].kind).toBe('audio')
  expect(backup.assets[item.assetId]).toMatch(/^data:audio\/webm.*;base64,/)
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({name:'audio-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))}),
  ])
  await page.getByRole('button',{name:'Reproducir nota de audio',exact:true}).click()
  await expect(page.getByRole('button',{name:'Pausar nota de audio',exact:true})).toBeVisible()
})

test('returning home confirms and persists a recording before navigating',async({page})=>{
  await page.route('http://127.0.0.1:4173/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Inicio</h1>'}))
  await page.mouse.move(300,300);await pressAudio(page)
  await expect(page.locator('.audio-note-status')).toContainText('0:01')
  await page.keyboard.press('Control+q')
  await page.waitForURL(url=>url.pathname==='/')
  expect((await saved(page)).media[0]).toMatchObject({kind:'audio',x:272,y:272})
})

test('failed audio saving blocks home navigation until a retry succeeds',async({page})=>{
  await page.route('http://127.0.0.1:4173/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Inicio</h1>'}))
  await page.evaluate(()=>window.failAudioSave=true)
  await pressAudio(page);await expect(page.locator('.audio-note-status')).toContainText('0:01')
  await page.keyboard.press('Control+q')
  await expect(page.locator('.audio-note-status')).toContainText('Sin espacio')
  expect(new URL(page.url()).pathname).toBe('/pizarra/')
  expect(await page.evaluate(()=>audioStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true)
  await page.evaluate(()=>window.failAudioSave=false);await page.keyboard.press('Control+q')
  await page.waitForURL(url=>url.pathname==='/')
  expect((await saved(page)).media).toHaveLength(1)
})
