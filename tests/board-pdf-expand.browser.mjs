import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { pdfFixture } from './helpers/pdf-fixture.mjs'

test('held PDF access expands atomically into grouped, lazy pages; undo, folder restore, tiles and source removal work', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, hasTouch:true, serviceWorkers: 'block' }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const directory = resolve('public/pizarra')
  await page.route('https://expand.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/setup') return route.fulfill({ contentType: 'text/html', body: '<html><body>Setup</body></html>' })
    if (!path.startsWith('/pizarra/') || path.startsWith('/pizarra/api/')) return route.fulfill({ status: 503, body: '{}' })
    const file = resolve(directory, '.' + (path === '/pizarra/' ? '/index.html' : path.slice('/pizarra'.length)))
    assert.ok(file.startsWith(directory + sep))
    try { return route.fulfill({ body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream' }) }
    catch { return route.fulfill({ status: 404 }) }
  })
  await page.goto('https://expand.test/setup')
  await page.evaluate(async bytes => {
    const root = await navigator.storage.getDirectory(), theory = await root.getDirectoryHandle('teoria', { create: true }), subject = await theory.getDirectoryHandle('test', { create: true })
    const writer = await (await subject.getFileHandle('original.pdf', { create: true })).createWritable()
    await writer.write(new Uint8Array(bytes)); await writer.close()
    const db = await new Promise(resolve => { const r = indexedDB.open('local-workspace', 1); r.onupgradeneeded = () => r.result.createObjectStore('workspace', { keyPath: 'id' }); r.onsuccess = () => resolve(r.result) })
    await new Promise(resolve => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put({ id: 'root-handle', handle: root }); tx.oncomplete = resolve }); db.close()
    const boards = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onupgradeneeded = () => {
      for (const name of ['boards', 'history']) r.result.createObjectStore(name, { keyPath: name === 'boards' ? 'key' : 'id' })
      r.result.createObjectStore('folders', { keyPath: 'id' }); r.result.createObjectStore('assets'); r.result.createObjectStore('meta')
    }; r.onsuccess = () => resolve(r.result) })
    const scene = { strokes: [], texts: [], media: [], tables: [], graphs: [], videos: [], camera: { x: 0, y: 0, zoom: 1 }, shapes: [
      { id: 'pdf-access', kind: 'rounded', visualType: 'pdf-shortcut', pdfPinned:true, pdfReference: { materialId: 1, subjectId: 'test', fileName: 'Original.pdf', workspaceFileId: 'workspace://teoria/test/original.pdf' }, label: 'Original', x: 100, y: 180, width: 240, height: 54, color: '#2563eb', strokeWidth: 1.5 },
    ] }
    await new Promise(resolve => { const tx = boards.transaction(['boards', 'meta'], 'readwrite'); tx.objectStore('boards').put({ key: 'local:expand', id: 'local:expand', name: 'Expansion', folder_id: null, storage: 'private', version: 0, updated_at: '', content: scene }); tx.objectStore('meta').put(true, 'legacy-migrated'); tx.oncomplete = resolve }); boards.close()
    localStorage.setItem('pizarra-modo-local-preferido', '1'); localStorage.setItem('pizarra_activa', 'local:expand')
  }, [...pdfFixture(40)])
  const scene = () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('boards')
    const read=async name=>{for(let attempt=0;;attempt++){try{return JSON.parse(await(await(await dir.getFileHandle(name)).getFile()).text())}catch(error){if(error.name!=='NotReadableError'||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,5))}}}
    const index = await read('library.json')
    return read(index.boards[0].path.slice(7))
  })
  const previews = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-image-previews-v1'); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('metadata').objectStore('metadata').getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
    return rows.map(row => { try { const k = JSON.parse(row.key); return k[0] === 'pdf-preview-v1' ? { page: JSON.parse(k[1].slice(4))[1], tile: JSON.parse(k[1].slice(4))[2], width: row.width, height: row.height } : null } catch { return null } }).filter(Boolean)
  })
  await page.goto('https://expand.test/pizarra/')
  await expect(page.locator('.app')).toHaveAttribute('data-board-id', 'local:expand')
  await expect(page.getByTitle('Mis pizarras',{exact:true})).toContainText('Expansion')
  await page.mouse.click(180,205)
  await expect(page.locator('.board-pdf-reader iframe')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.board-pdf-reader iframe'),'a pinned reader stays retained before conversion').toHaveCount(1)
  // A second finger cancels the hold before conversion and permits navigation.
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:205,id:1}]})
  await page.waitForTimeout(100)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:205,id:1},{x:400,y:400,id:2}]})
  await page.waitForTimeout(700)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  assert.equal((await scene()).scene.media.length,0)
  await page.mouse.move(180, 205); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up()
  await expect.poll(async () => (await scene()).scene.media.length, { timeout: 20000 }).toBe(40).catch(async error=>{
    t.diagnostic(JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,board:document.querySelector('.app')?.dataset}))))
    throw error
  })
  const expanded = await scene()
  await expect(page.locator('.board-pdf-reader iframe')).toHaveCount(0)
  assert.equal(expanded.scene.shapes.length, 0)
  assert.equal(Object.keys(expanded.assets).length, 1, 'all pages share one original asset')
  assert.equal(new Set(expanded.scene.media.map(item => item.groupId)).size, 1)
  assert.ok(expanded.scene.media.every(item => item.pdfSource && item.assetId === expanded.scene.media[0].assetId))
  assert.equal(expanded.scene.media[0].x, 100); assert.equal(expanded.scene.media[0].y, 180)
  assert.equal(expanded.scene.media[1].y, 180 + 792 + 30)
  assert.equal(expanded.scene.media[1].width, 420)
  await expect.poll(async () => (await previews()).length, { timeout: 20000 }).toBeGreaterThan(0)
  assert.ok(new Set((await previews()).map(p => p.page)).size < 5, 'unseen pages must not rasterize')
  const pixel = () => page.locator('.app > canvas').first().evaluate(node => [...node.getContext('2d').getImageData(120, 220, 1, 1).data].slice(0, 3))
  await expect.poll(pixel).toEqual([255, 0, 0])
  await page.screenshot({path:'.cache/pdf-expanded.png'})
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await scene()).scene.media.length).toBe(0)
  assert.equal((await scene()).scene.shapes[0].id, 'pdf-access')
  // Touch and pen take the same conversion path, without drawing stray strokes.
  for(const pointer of ['touch','pen']){
    if(pointer==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:205,id:1}]})
    else await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:180,y:205,button:'left',buttons:1,clickCount:1,pointerType:'pen'})
    await page.waitForTimeout(700)
    if(pointer==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    else await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:180,y:205,button:'left',buttons:0,clickCount:1,pointerType:'pen'})
    await expect.poll(async()=>(await scene()).scene.media.length,{timeout:15000}).toBe(40)
    assert.equal((await scene()).scene.strokes.length,0)
    await page.keyboard.press('Control+z')
    await expect.poll(async()=>(await scene()).scene.media.length).toBe(0)
  }
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await scene()).scene.media.length).toBe(40)
  // Cropping rasterizes only the selected page and can be undone normally.
  await page.mouse.click(150,300,{button:'right'})
  await page.getByRole('menuitem',{name:'Desagrupar',exact:true}).click()
  await page.mouse.click(1050,800)
  await page.mouse.click(150,300,{button:'right'})
  await page.getByRole('menuitem',{name:'Recortar imagen',exact:true}).click()
  const crop=page.getByRole('dialog',{name:'Recortar imagen',exact:true})
  await expect.poll(()=>crop.getByRole('img',{name:'Imagen para recortar'}).evaluate(node=>node.naturalWidth)).toBeGreaterThan(0)
  const cropBox=await crop.locator('.image-crop-surface').boundingBox()
  await page.mouse.move(cropBox.x+cropBox.width*.2,cropBox.y+cropBox.height*.2);await page.mouse.down()
  await page.mouse.move(cropBox.x+cropBox.width*.8,cropBox.y+cropBox.height*.8,{steps:5});await page.mouse.up()
  await crop.getByRole('button',{name:'Aplicar recorte',exact:true}).click()
  await expect.poll(async()=>(await scene()).scene.media.filter(item=>item.pdfSource).length).toBe(39)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await scene()).scene.media.filter(item=>item.pdfSource).length).toBe(40)
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>new Set((await scene()).scene.media.map(item=>item.groupId)).size).toBe(1)
  // Navigate at high zoom: only the visible part of page one needs detail tiles.
  await page.keyboard.down('Control')
  await page.mouse.move(300, 400); await page.mouse.wheel(0, -1000)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await previews()).some(p => p.tile !== 'preview'), { timeout: 20000 }).toBe(true)
  assert.ok((await previews()).filter(p => p.tile !== 'preview').every(p => p.width <= 1024 && p.height <= 1024))
  await expect.poll(async()=>(await scene()).scene.camera.zoom).toBeGreaterThan(2)
  // Remove the source and every browser board/asset record. The workspace is sufficient.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), subject = await (await root.getDirectoryHandle('teoria')).getDirectoryHandle('test')
    await subject.removeEntry('original.pdf')
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
    await new Promise(resolve => { const tx = db.transaction(['boards', 'assets', 'meta'], 'readwrite'); for (const name of ['boards', 'assets', 'meta']) tx.objectStore(name).clear(); tx.oncomplete = resolve }); db.close()
  })
  await page.reload()
  await expect(page.locator('.app')).toHaveAttribute('data-board-id', 'local:expand')
  await expect(page.getByTitle('Mis pizarras',{exact:true})).toContainText('Expansion')
  assert.equal((await scene()).scene.media.length, 40)
  const original=await page.evaluate(async()=>{
    const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('boards')
    const index=JSON.parse(await(await(await dir.getFileHandle('library.json')).getFile()).text())
    const doc=JSON.parse(await(await(await dir.getFileHandle(index.boards[0].path.slice(7))).getFile()).text())
    return [...new Uint8Array(await(await(await dir.getFileHandle(Object.values(doc.assets)[0].slice(7))).getFile()).arrayBuffer())]
  })
  assert.deepEqual(original,[...pdfFixture(40)])
  assert.ok(page.workers().length <= 2)
  // A blocked or invalid source leaves its shortcut and the other pages intact.
  let release, mode='pending'
  const gate=new Promise(resolve=>{release=resolve})
  await page.route('https://expand.test/api/subject-day-materials/99/file',async route=>{
    if(mode==='pending')await gate
    await route.fulfill({status:mode==='denied'?403:200,contentType:'application/pdf',body:mode==='corrupt'?Buffer.from('not a PDF'):pdfFixture(2)}).catch(()=>{})
  })
  await page.locator('.app > canvas').first().evaluate(canvas=>{
    const dataTransfer=new DataTransfer()
    dataTransfer.setData('application/x-cursado-board-pdf',JSON.stringify({materialId:99,subjectId:'test',fileName:'Unavailable.pdf',workspaceFileId:null}))
    canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX:850,clientY:180}))
  })
  await expect.poll(async()=>(await scene()).scene.shapes.length).toBe(1)
  const holdUnavailable=async()=>{await page.mouse.move(880,205);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up()}
  await holdUnavailable()
  await expect(page.getByRole('status')).toContainText('Cargando PDF')
  await page.keyboard.press('Escape');release()
  await expect(page.locator('.importing')).toHaveCount(0)
  assert.equal((await scene()).scene.shapes.length,1)
  assert.equal((await scene()).scene.media.length,40)
  for(const failure of ['denied','corrupt']){
    mode=failure
    await holdUnavailable()
    const error=page.getByRole('dialog',{name:'Imagen o selección de la pizarra'})
    await expect(error.getByRole('alert')).toBeVisible({timeout:15000})
    assert.equal((await scene()).scene.shapes.length,1)
    assert.equal((await scene()).scene.media.length,40)
    await error.getByRole('button',{name:'Cerrar',exact:true}).click()
  }
  mode='valid'
  await page.evaluate(async()=>{
    const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('boards')
    const index=JSON.parse(await(await(await dir.getFileHandle('library.json')).getFile()).text())
    const handle=await dir.getFileHandle(index.boards[0].path.slice(7)),doc=JSON.parse(await(await handle.getFile()).text())
    const access=doc.scene.shapes[0];access.groupId='existing-group'
    doc.scene.shapes.push({id:'other-group-member',kind:'rectangle',x:access.x+500,y:access.y+400,width:80,height:80,color:'#00ff00',strokeWidth:2,groupId:'existing-group'})
    const writer=await handle.createWritable();await writer.write(JSON.stringify(doc));await writer.close()
  })
  await page.reload()
  await expect(page.getByTitle('Mis pizarras',{exact:true})).toContainText('Expansion')
  await holdUnavailable()
  await expect.poll(async()=>(await scene()).scene.media.length,{timeout:20000}).toBe(42)
  const grouped=await scene()
  assert.ok(grouped.scene.media.slice(-2).every(item=>item.groupId==='existing-group'))
  assert.equal(grouped.scene.shapes[0].id,'other-group-member')
  await page.keyboard.press('Control+z')
  await expect.poll(async()=>(await scene()).scene.media.length).toBe(40)
  assert.equal((await scene()).scene.shapes.length,2,'undo only reverts this conversion')
  assert.deepEqual(errors, [])
})
