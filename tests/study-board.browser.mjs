import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

// Uses the existing local Vite + Worker stack; no Next production build is needed.
const origin = process.env.STUDY_TEST_ORIGIN || 'http://127.0.0.1:5173'
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import {createRoot} from 'react-dom/client';
  import {TopicBoardOverlay} from './components/topic-board-overlay';
  const fs=await navigator.storage.getDirectory();
  const dir=await(await fs.getDirectoryHandle('progreso',{create:true})).getDirectoryHandle('pizarras',{create:true});
  const root=createRoot(document.getElementById('root'));
  window.read=async path=>{let directory=fs;const parts=path.split('/');for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);return JSON.parse(await(await(await directory.getFileHandle(parts.at(-1))).getFile()).text())};
  window.openBoard=id=>root.render(<TopicBoardOverlay key={id} boardId={id} name={id} rootHandle={fs} pdfReferences={[{materialId:1,subjectId:'subject',fileName:'Uno.pdf',workspaceFileId:'workspace://teoria/uno.pdf'},{materialId:2,subjectId:'subject',fileName:'Dos.pdf',workspaceFileId:'workspace://teoria/dos.pdf'}]} onClose={()=>{window.boardClosed=true;root.render(<button onClick={()=>window.openBoard(id)}>Reabrir</button>)}}/>);
  const taskWriter=await(await(await fs.getDirectoryHandle('progreso')).getFileHandle('importantes.json',{create:true})).createWritable();await taskWriter.write(JSON.stringify({version:1,tasks:[{id:'task',text:'Examen',startDate:'2026-01-01',dueDate:'2099-12-31',url:'',topics:[]}]}));await taskWriter.close();
  for(const id of ['first','second','image','target','upload-failure']){
    let present=false;try{await dir.getFileHandle(id+'.json');present=true}catch{}
    if(present)continue;
    const content={camera:{x:0,y:0,zoom:1},strokes:[{id:'s',points:[{x:80,y:90},{x:260,y:90}],width:3,color:'#ff0000'}],texts:[{id:'t',x:90,y:140,text:'Texto '+id,color:'#000000',fontSize:24}],media:[],shapes:[],tables:[],graphs:[],videos:[]};
    const assets={};
    if(id==='image'){content.media.push({id:'i',kind:'image',assetId:'asset',x:90,y:210,width:100,height:100});assets.asset='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}
    if(id==='upload-failure'){for(let i=0;i<3;i++){content.media.push({id:'image-'+i,kind:'image',assetId:'asset-'+i,x:90+i*120,y:210,width:100,height:100});assets['asset-'+i]='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}}
    const writer=await(await dir.getFileHandle(id+'.json',{create:true})).createWritable();await writer.write(JSON.stringify({version:1,boardId:id,name:id,content,assets}));await writer.close();
  }
  if(!new URLSearchParams(location.search).has('defer'))window.openBoard(new URLSearchParams(location.search).get('board')||'first');
`, loader: 'tsx' }, loader: { '.css': 'empty' }, jsx: 'automatic', bundle: true, format: 'esm', write: false })

async function fixture(context) {
  await context.grantPermissions(['local-network-access'])
  await context.addInitScript(() => { localStorage.setItem('komuboard-identity-nudged', '1'); window.__komuboardAutoFit = false; window.debugEvents=[];addEventListener('message',event=>{if(event.data?.type)window.debugEvents.push(event.data.type)});addEventListener('keydown',event=>window.debugEvents.push('key:'+event.key),true) })
  await context.addInitScript(() => {
    window.YT = { Player: class {
      constructor(element, options) { this.position = 0; this.state = 2; this.options = options; this.frame = document.createElement('iframe'); this.frame.dataset.youtubeTest = 'true'; element.append(this.frame); queueMicrotask(() => options.events.onReady()) }
      playVideo() { this.state = 1; this.options.events.onStateChange({ data: 1 }) }
      pauseVideo() { this.state = 2; this.options.events.onStateChange({ data: 2 }) }
      seekTo(value) { this.position = value }
      getCurrentTime() { return this.position }
      getPlayerState() { return this.state }
      destroy() { this.frame.remove() }
    } }
  })
  await context.route('**/study-fixture**', route => route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}.fixed{position:fixed}.inset-0{inset:0}.inset-8{inset:32px}.flex-1{flex:1}.overflow-auto{overflow:auto}.absolute{position:absolute}.relative{position:relative}.flex{display:flex}.h-full{height:100%}.w-full{width:100%}.w-1\\/2{width:50%}.top-3{top:12px}.left-3{left:12px}.right-4{right:16px}.bottom-4{bottom:16px}.bottom-3{bottom:12px}.bottom-16{bottom:64px}.left-16{left:64px}.z-20{z-index:20}.z-30{z-index:30}.z-40{z-index:40}.z-50{z-index:50}.flex-col{flex-direction:column}.bg-white{background:white}iframe{border:0}button{cursor:pointer} [inert]{pointer-events:none}</style><div id="root"></div><script type="module" src="/study-parent.js"></script>` }))
  await context.route('**/study-parent.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }))
  await context.route('**/pizarra/api/excel/import', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sheets: [{ name: 'Hoja importada', cells: [[{ input: '=2+3' }]], truncated: false }] }) }))
  await context.route('**/study-board/index.html?**', async route => {
    const response = await route.fetch({ url: origin + '/' }); await route.fulfill({ response })
  })
  await context.route('**/biblioteca/pizarra?**', route => {
    const url = new URL(route.request().url()), reader = url.searchParams.get('mode') === 'reader'
    return route.fulfill({ contentType: 'text/html', body: `<p>${reader ? 'PDF de prueba' : 'Inicio de Estudio'}</p><script>
      window.visibility=[];const params=new URLSearchParams(location.search),session=params.get('session'),boardId=params.get('boardId');
      const send=type=>parent.postMessage({type,session,boardId},location.origin);
      addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;if(event.data.type==='board-library:init')window.reference=event.data.reference;if(event.data.type==='board-library:reader-visibility')window.visibility.push(event.data.visible)});
      addEventListener('keydown',event=>{if(['Escape','<'].includes(event.key))send('board-library:reader-closed')});send('board-library:ready');
      </script>` })
  })
}
function onePagePdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 160] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream']
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}
const engine = page => page.frames().find(frame => frame.url().includes('/study-board/index.html'))
async function loaded(page, board) {
  try { await expect.poll(async () => { try { const frame=engine(page); if(board && !frame?.url().includes('topicBoard='+board))return false; return Boolean(await frame?.evaluate(() => window.__komuboard?.doc.getMap('study-migration').get('complete'))) } catch { return false } }, { timeout: 20000 }).toBe(true) }
  catch (error) { console.error('Study startup:', await page.locator('body').innerText(), await engine(page)?.locator('body').innerText()); throw error }
}
async function send(page, type, data = {}) {
  await page.evaluate(({ type, data }) => {
    const iframe = document.querySelector('iframe'), url = new URL(iframe.src)
    iframe.contentWindow.postMessage({ type: 'study-board:' + type, session: url.searchParams.get('session'), boardId: url.searchParams.get('topicBoard'), ...data }, location.origin)
  }, { type, data })
}

test('Study integration: review by type, retained PDF, imports, links, two-client sync and cancellation', { timeout: 150000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context)
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message) })
  page.on('requestfailed', request => { if (request.url().includes('/rooms/')) console.error('Room request:', request.url(), request.failure()) })
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()) })
  await page.goto(origin + '/study-fixture?board=first'); await loaded(page)
  await expect(page.getByText('¿Confirmás la migración?')).toBeVisible()
  assert.equal(await engine(page).evaluate(() => window.__komuboard.doc.getMap('objects').size), 4)
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click()
  await expect(page.getByText('¿Confirmás la migración?')).toHaveCount(0)
  const firstRoom = await page.evaluate(async () => (await window.read('progreso/pizarra-sync/first.json')).roomId)

  const peer = await context.newPage(); await peer.goto(origin + '/study-fixture?board=first'); await loaded(peer)
  assert.equal(await peer.evaluate(async () => (await window.read('progreso/pizarra-sync/first.json')).roomId), firstRoom)
  assert.equal(await engine(peer).evaluate(() => new Set(window.__komuboard.doc.getArray('order').toArray()).size), 4)
  const pdfId = await engine(page).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].find(map => map.get('study')?.reference?.materialId === 1).get('id'))
  const card = engine(page).locator(`[data-study="pdf"][data-id="${pdfId}"]`)
  await engine(page).evaluate(() => window.__komuboard.canvas.zoomTo(1))
  const normalHeight = (await card.boundingBox()).height
  await engine(page).evaluate(() => window.__komuboard.canvas.zoomTo(0.25))
  await expect.poll(() => card.locator('button').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(3)
  assert.ok((await card.boundingBox()).height < normalHeight * 0.4)
  await expect(card.locator('button').first()).toHaveCSS('white-space', 'nowrap')
  await engine(page).evaluate(() => window.__komuboard.canvas.zoomTo(1))
  await send(page, 'pin', { id: pdfId })
  await expect.poll(() => engine(peer).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).get('study').pinned, pdfId)).toBe(true)
  const pinButton = engine(page).getByRole('button', { name: 'PDF fijado', exact: true })
  await expect(pinButton).toBeEnabled()
  await expect(page.getByRole('navigation', { name: 'PDF fijado' })).toHaveCount(0)
  assert.equal(await engine(page).locator('komu-tool-dock button').last().getAttribute('aria-label'), 'Agregar a la pizarra')
  const pdfX = await engine(page).evaluate(id => { const map = window.__komuboard.doc.getMap('objects').get(id); const x = map.get('x'); map.set('x', 10000); return x }, pdfId)
  // Use a real pointer so capture and the release-generated click are both exercised.
  await pinButton.hover(); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up()
  await expect(engine(page).locator(`.komu-text-resize[data-id="${pdfId}"]`)).toBeVisible()
  const selectedBox = await card.boundingBox()
  assert.ok(selectedBox.x >= 0 && selectedBox.x < 1440)
  await expect(page.getByTitle('Lector de PDF de la pizarra')).toHaveCount(0)
  await engine(page).evaluate(({id, x}) => { window.__komuboard.doc.getMap('objects').get(id).set('x', x); window.__komuboard.canvas.restoreStudyView({x:0,y:0,zoom:1}) }, {id:pdfId,x:pdfX})
  await pinButton.click()
  const pdf = page.getByTitle('Lector de PDF de la pizarra'); await expect(pdf).toHaveCount(1)
  const reader = page.frames().find(frame => frame.url().includes('mode=reader'))
  await reader.evaluate(() => { window.retentionSentinel = 'retained' })
  await reader.locator('body').press('Escape')
  await expect(pdf.locator('..')).toHaveAttribute('aria-hidden', 'true')
  await expect(pdf).toHaveCount(1)
  await engine(page).locator('body').press('<')
  await expect(pdf.locator('..')).toHaveAttribute('aria-hidden', 'false')
  assert.equal(await reader.evaluate(() => window.retentionSentinel), 'retained')
  await reader.locator('body').press('<')
  await expect(pdf.locator('..')).toHaveAttribute('aria-hidden', 'true')
  await send(page, 'pin', { id: pdfId })
  await expect.poll(() => engine(page).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).get('study').pinned, pdfId)).toBe(false)
  await expect(pinButton).toBeDisabled()
  try { await expect(pdf).toHaveCount(0) } catch(error) { console.error('Reader events',await page.evaluate(()=>window.debugEvents),await reader.evaluate(()=>window.debugEvents),await engine(page).evaluate(()=>window.debugEvents)); throw error }

  await engine(page).getByRole('button', { name: 'Agregar a la pizarra' }).click()
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click()
  await expect(page.getByTitle('Biblioteca de Estudio')).toHaveCount(1)
  const widths = await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getBoundingClientRect().width))
  assert.ok(Math.abs(widths[0] - widths[1]) < 2)
  await page.getByRole('button', { name: 'Cerrar biblioteca' }).click()
  await page.locator('input[type=file]').setInputFiles([{ name: 'datos.csv', mimeType: 'text/csv', buffer: Buffer.from('Nombre;Cantidad\nEjemplo;=1+2') }, { name: 'dibujo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="red"/></svg>') }])
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('study')?.kind === 'table').length)).toBe(1)
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('type') === 'image').length)).toBe(1)
  await engine(page).getByRole('button', { name: 'Editar tabla', exact: true }).click()
  await page.getByRole('textbox', { name: 'Fórmula o valor de A1', exact: true }).fill('Editado')
  await page.getByRole('textbox', { name: 'Fórmula o valor de A1', exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Guardar tabla', exact: true }).click()
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].find(map => map.get('study')?.kind === 'table').get('study').table.cells[0][0].input)).toBe('Editado')
  await page.locator('input[type=file]').setInputFiles([{ name: 'pagina.pdf', mimeType: 'application/pdf', buffer: onePagePdf() }, { name: 'hoja.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('service-fixture') }])
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('type') === 'image').length), { timeout: 20000 }).toBe(2)
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('study')?.kind === 'table').length)).toBe(2)
  await engine(page).evaluate(() => {
    const transfer = new DataTransfer(); transfer.setData('application/x-cursado-important', JSON.stringify({ taskId: 'task' }))
    document.getElementById('board').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer, clientX: 600, clientY: 600 }))
  })
  await expect(engine(page).locator('[data-study=important] .study-card-label')).toHaveText(/^\d+d$/)
  await engine(page).getByRole('button', { name: 'Agregar a la pizarra' }).click()
  await page.getByRole('button', { name: 'Link YouTube', exact: true }).click()
  await page.getByRole('textbox', { name: 'Link YouTube' }).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Agregar', exact: true }).click()
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('study')?.kind === 'youtube').length)).toBe(1)
  await engine(page).locator('.board-video-toolbar input').nth(0).fill('0:10')
  await engine(page).locator('.board-video-toolbar input').nth(1).fill('0:20')
  await engine(page).getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect.poll(() => engine(peer).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].find(map => map.get('study')?.kind === 'youtube').get('study').start)).toBe(10)
  assert.ok((await engine(page).locator('iframe[data-youtube-test]').boundingBox()).height > 100)
  await send(page, 'insert', { object: { id: '', type: 'text', authorId: 'test', x: 100, y: 400, width: 320, height: 62, runs: [{ text: 'Destino' }], fontFamily: 'system-ui', fontSize: 18, align: 'left', study: { kind: 'board', reference: { boardId: 'local:important-target', name: 'Destino' } } } })
  await engine(page).locator('[data-study=board] button').click()
  await expect.poll(() => engine(page)?.url().includes('topicBoard=target')).toBe(true); await loaded(page)
  await page.getByRole('button', { name: 'Volver a la pizarra anterior' }).click(); await loaded(page, 'first')
  await peer.close()

  await page.evaluate(() => window.openBoard('second')); await loaded(page, 'second')
  await expect(page.getByText('¿Confirmás la migración?')).toHaveCount(0)
  await page.evaluate(() => window.openBoard('image')); await loaded(page, 'image')
  await expect(page.getByText('¿Confirmás la migración?')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible()
  const cancelled = await page.evaluate(async () => ({ record: await window.read('progreso/pizarra-sync/image.json'), approved: await window.read('progreso/pizarra-sync/migration-approvals.json'), original: await window.read('progreso/pizarras/image.json') }))
  assert.equal(cancelled.record.status, 'cancelled'); assert.ok(cancelled.record.draft); assert.equal(cancelled.approved.images, undefined); assert.equal(cancelled.original.content.media.length, 1)
  await page.getByRole('button', { name: 'Reabrir' }).click(); await loaded(page)
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => (await window.read('progreso/pizarra-sync/migration-approvals.json')).images)).toBe(1)
  assert.deepEqual(errors, [])
})

test('Shapes stay active for repeated arrows and figures until Escape or a tool change', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => localStorage.setItem('komuboard-identity-nudged', '1'))
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto((process.env.STUDY_ENGINE_URL || origin + '/') + '?room=repeat-shapes-' + crypto.randomUUID())
  await page.waitForFunction(() => window.__komuboard?.provider.synced && window.__komuboard?.canvas)
  const tool = () => page.evaluate(() => window.__komuboard.canvas.tool)
  const objects = () => page.evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].map(map => map.toJSON()))
  const drag = async (y) => { await page.mouse.move(700, y); await page.mouse.down(); await page.mouse.move(850, y + 40, { steps: 5 }); await page.mouse.up() }
  await page.locator('[data-tool="shapes"]').click()
  await page.locator('komu-shape-menu [data-kind="arrow"]').click()
  await drag(250); await drag(350)
  assert.equal((await objects()).filter(object => object.type === 'connector' && object.kind === 'arrow').length, 2)
  assert.equal(await tool(), 'shapes')
  await page.locator('komu-shape-menu [data-kind="rectangle"]').click()
  await page.mouse.click(700, 500); await page.keyboard.type('Uno'); await page.keyboard.press('Control+Enter')
  assert.equal(await tool(), 'shapes')
  await page.mouse.click(950, 500); await page.keyboard.type('Dos'); await page.keyboard.press('Control+Enter')
  assert.equal((await objects()).filter(object => object.shape === 'rectangle').length, 2)
  assert.equal(await tool(), 'shapes')
  await page.mouse.click(700, 700); await page.keyboard.press('Escape')
  assert.equal(await tool(), 'select')
  await page.locator('[data-tool="shapes"]').click()
  await page.locator('komu-shape-menu [data-kind="ellipse"]').click()
  await page.mouse.click(950, 700); await page.keyboard.type('Oval'); await page.locator('[data-tool="pen"]').click()
  assert.equal(await tool(), 'pen'); assert.ok((await objects()).some(object => object.shape === 'ellipse'))
  await page.locator('[data-tool="shapes"]').click()
  await page.locator('komu-shape-menu .sm-more').click()
  await page.locator('komu-shape-panel .sp-search input').fill('rect')
  await page.keyboard.press('Escape')
  assert.equal(await tool(), 'select'); await expect(page.locator('komu-shape-panel')).toBeHidden()
  await page.locator('[data-tool="shapes"]').click()
  await page.locator('komu-shape-menu [data-kind="arrow"]').click()
  const count = (await objects()).length
  await page.mouse.move(500, 850); await page.mouse.down(); await page.mouse.move(650, 900, { steps: 5 }); await page.keyboard.press('Escape'); await page.mouse.up()
  assert.equal(await tool(), 'select'); assert.equal((await objects()).length, count)
  assert.deepEqual(errors, [])
})

test('simultaneous first migration converges without duplicate objects or z-order entries', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context)
  const a = await context.newPage(), b = await context.newPage()
  await a.goto(origin + '/study-fixture?defer=1'); await a.waitForFunction(() => window.openBoard)
  await b.goto(origin + '/study-fixture?defer=1'); await b.waitForFunction(() => window.openBoard)
  await Promise.all([a.evaluate(() => window.openBoard('target')), b.evaluate(() => window.openBoard('target'))])
  await Promise.all([loaded(a, 'target'), loaded(b, 'target')])
  const snapshot = page => engine(page).evaluate(() => ({ order: window.__komuboard.doc.getArray('order').toArray(), objects: window.__komuboard.doc.getMap('objects').toJSON() }))
  await expect.poll(() => snapshot(a)).toEqual(await snapshot(b))
  const result = await snapshot(a)
  assert.equal(result.order.length, 4); assert.equal(new Set(result.order).size, 4); assert.equal(Object.keys(result.objects).length, 4)
})

test('failed migration has one compact notice and retries uploads without losing successes; 429 recovers automatically', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context)
  let blocked = true, throttled = false, posts = 0
  await context.route('**/img/*', route => route.request().method() === 'HEAD' ? route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }) : route.continue())
  await context.route('**/upload', route => {
    if (route.request().method() !== 'POST') return route.continue()
    posts++
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After', 'Retry-After': '0' }
    if (blocked && posts > 1) return route.fulfill({ status: 415, headers, body: '{}' })
    if (!blocked && !throttled) { throttled = true; return route.fulfill({ status: 429, headers, body: '{}' }) }
    return route.continue()
  })
  const page = await context.newPage(); await page.goto(origin + '/study-fixture?board=upload-failure')
  const notice = page.getByRole('alert')
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText('2 elementos')
  assert.ok((await notice.boundingBox()).height <= 240)
  assert.ok((await notice.innerText()).length < 500)
  await expect(page.getByText('¿Confirmás la migración?')).toHaveCount(0)
  assert.equal(posts, 3)
  blocked = false
  await page.getByRole('button', { name: 'Reintentar migración' }).click()
  await loaded(page, 'upload-failure')
  await expect(notice).toHaveCount(0)
  await expect(page.getByText('¿Confirmás la migración?')).toBeVisible()
  assert.equal(posts, 6); assert.equal(throttled, true)
  const result = await engine(page).evaluate(() => ({ count: window.__komuboard.doc.getMap('objects').size, order: window.__komuboard.doc.getArray('order').toArray() }))
  assert.equal(result.count, 7); assert.equal(new Set(result.order).size, 7)
})
