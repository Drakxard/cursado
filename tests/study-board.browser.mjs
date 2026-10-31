import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Uses the existing local Vite + Worker stack; no Next production build is needed.
const origin = process.env.STUDY_TEST_ORIGIN || 'http://127.0.0.1:5173'
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import {createRoot} from 'react-dom/client';
  import {TopicBoardOverlay} from './components/topic-board-overlay';
  import {StudyBoardNavigationContext} from './components/study-board-navigation';
  import {StudyImportantTasks} from './components/study-important-tasks';
  import {NativeWorkspaceProvider} from './components/local-workspace-provider';
  import {cooperationState} from './lib/client/cooperation';
  const fs=await navigator.storage.getDirectory();
  const dir=await(await fs.getDirectoryHandle('progreso',{create:true})).getDirectoryHandle('pizarras',{create:true});
  const root=createRoot(document.getElementById('root'));
  const persistentStudy=children=><NativeWorkspaceProvider rootHandle={fs}><StudyImportantTasks>{children}</StudyImportantTasks></NativeWorkspaceProvider>;
  window.openNamedBoard=(id,week)=>root.render(persistentStudy(<TopicBoardOverlay key={id} boardId={id} name="Base de Datos · temas" cooperationWeekNumber={week} rootHandle={fs} onClose={()=>root.render(persistentStudy(<button onClick={()=>window.openPersistentBoard()}>Abrir pizarra</button>))}/>));
  window.openPersistentBoard=()=>window.openNamedBoard('route-first',4);
  window.delegateBoard=()=>root.render(<StudyBoardNavigationContext.Provider value={reference=>{window.delegatedBoard=reference}}><TopicBoardOverlay boardId="target" name="Destino" rootHandle={fs} onClose={()=>{}} /></StudyBoardNavigationContext.Provider>);
  window.read=async path=>{let directory=fs;const parts=path.split('/');for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part);return JSON.parse(await(await(await directory.getFileHandle(parts.at(-1))).getFile()).text())};
  window.openBoard=id=>root.render(<TopicBoardOverlay key={id} boardId={id} name={id} rootHandle={fs} pdfReferences={[{materialId:1,subjectId:'subject',fileName:'Uno.pdf',workspaceFileId:'workspace://teoria/uno.pdf'},{materialId:2,subjectId:'subject',fileName:'Dos.pdf',workspaceFileId:'workspace://teoria/dos.pdf'}]} onClose={()=>{window.boardClosed=true;root.render(<button onClick={()=>window.openBoard(id)}>Reabrir</button>)}}/>);
  window.openCooperativeBoard=({sphereId,owner})=>{
    const subjectId=owner?'algebra':'coop-'+sphereId;
    cooperationState().mirrors[sphereId]={binding:{id:sphereId,groupId:'group',subjectId,storageKey:owner?'Algebra':'Cooperativo',sourceId:'algebra',sourceKey:'Algebra',name:'Álgebra',color:'#123456',owner},baseline:{seq:0,resources:{},conflicts:[]}};
    const id='study-cooperative'+(owner?'':'-'+sphereId.slice(0,8));
    root.render(<TopicBoardOverlay key={id} boardId={id} cooperationSubjectId={subjectId} name="Contenedor cooperativo" rootHandle={fs} onClose={()=>root.render(null)} />);
  };
  const taskWriter=await(await(await fs.getDirectoryHandle('progreso')).getFileHandle('importantes.json',{create:true})).createWritable();await taskWriter.write(JSON.stringify({version:1,tasks:[{id:'task',text:'Examen',startDate:'2026-01-01',dueDate:'2099-12-31',url:'',topics:[]}]}));await taskWriter.close();
  for(const id of ['first','second','image','target','upload-failure','review']){
    let present=false;try{await dir.getFileHandle(id+'.json');present=true}catch{}
    if(present)continue;
    const content={camera:{x:0,y:0,zoom:1},strokes:[{id:'s',points:[{x:80,y:90},{x:260,y:90}],width:3,color:'#ff0000'}],texts:[{id:'t',x:90,y:140,text:'Texto '+id,color:'#000000',fontSize:24}],media:[],shapes:[],tables:[],graphs:[],videos:[]};
    const assets={};
    if(id==='review')content.shapes.push(
      {id:'marker',kind:'circle',visualType:'review-marker',x:100,y:200,width:56,height:56,color:'#202020',strokeWidth:3.5,reviewView:{center:{x:500,y:400},zoom:1}},
      {id:'countdown',kind:'rectangle',visualType:'important-countdown',x:400,y:200,width:140,height:64,importantTaskId:'task',label:'Examen'},
      {id:'shape',kind:'rectangle',x:600,y:200,width:120,height:80,color:'#000',strokeWidth:2,label:'Figura'}
    );
    if(id==='image'){content.media.push({id:'i',kind:'image',assetId:'asset',x:90,y:210,width:100,height:100});assets.asset='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}
    if(id==='upload-failure'){for(let i=0;i<3;i++){content.media.push({id:'image-'+i,kind:'image',assetId:'asset-'+i,x:90+i*120,y:210,width:100,height:100});assets['asset-'+i]='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='}}
    const writer=await(await dir.getFileHandle(id+'.json',{create:true})).createWritable();await writer.write(JSON.stringify({version:1,boardId:id,name:id,content,assets}));await writer.close();
  }
  if(new URLSearchParams(location.search).has('persist'))root.render(persistentStudy(<button onClick={()=>window.openPersistentBoard()}>Abrir pizarra</button>));
  else if(!new URLSearchParams(location.search).has('defer'))window.openBoard(new URLSearchParams(location.search).get('board')||'first');
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
    if (process.env.STUDY_TEST_BUILT === '1') {
      await route.fulfill({ contentType: 'text/html', body: await readFile('public/study-board/index.html', 'utf8') }); return
    }
    const response = await route.fetch({ url: origin + '/' }); await route.fulfill({ response })
  })
  if (process.env.STUDY_TEST_BUILT === '1') await context.route('**/study-board/assets/**', async route => {
    const root = path.resolve('public/study-board/assets'), file = path.resolve(root, path.basename(new URL(route.request().url()).pathname))
    await route.fulfill({ path: file })
  })
  await context.route('**/biblioteca/pizarra?**', route => {
    const url = new URL(route.request().url()), reader = url.searchParams.get('mode') === 'reader'
    return route.fulfill({ contentType: 'text/html', body: `<p>${reader ? 'PDF de prueba' : 'Inicio de Estudio'}</p><script>
      window.visibility=[];const params=new URLSearchParams(location.search),session=params.get('session'),boardId=params.get('boardId');
      const send=type=>parent.postMessage({type,session,boardId},location.origin);
      addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;if(event.data.type==='board-library:init'){window.reference=event.data.reference;if(window.reference)setTimeout(()=>send('board-library:reader-rendered'),200);}if(event.data.type==='board-library:reader-visibility')window.visibility.push(event.data.visible)});
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
  await expect(card.locator('button')).toHaveCount(0)
  await expect.poll(async () => (await card.boundingBox()).height).toBeLessThan(normalHeight * 0.4)
  await expect(card.locator('a')).toHaveText('Uno.pdf')
  await engine(page).evaluate(() => window.__komuboard.canvas.zoomTo(1))
  await expect.poll(async () => Math.abs((await card.boundingBox()).height - normalHeight)).toBeLessThan(1)
  const holdBox = await card.boundingBox()
  await page.bringToFront()
  await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2); await page.mouse.down()
  await expect.poll(() => engine(page).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).get('study').pinned, pdfId)).toBe(true)
  await page.mouse.up()
  await expect.poll(() => engine(peer).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).get('study').pinned, pdfId)).toBe(true)
  await expect(engine(page).getByRole('button', { name: 'PDF fijado', exact: true })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'PDF fijado' })).toHaveCount(0)
  assert.equal(await engine(page).locator('komu-tool-dock button').last().getAttribute('aria-label'), 'Agregar a la pizarra')
  await expect(engine(page).getByRole('button', { name: 'Diagramas', exact: true })).toHaveCount(1)
  await card.locator('a').click({ force: true })
  const pdf = page.getByTitle('Lector de PDF de la pizarra'); await expect(pdf).toBeVisible()
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
  try { await expect(pdf).toHaveCount(0) } catch(error) { console.error('Reader events',await page.evaluate(()=>window.debugEvents),await reader.evaluate(()=>window.debugEvents),await engine(page).evaluate(()=>window.debugEvents)); throw error }

  await engine(page).getByRole('button', { name: 'Agregar a la pizarra' }).click()
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click()
  await expect(page.getByTitle('Biblioteca de Estudio')).toHaveCount(1)
  const widths = await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getBoundingClientRect().width))
  assert.ok(Math.abs(widths[0] - widths[1]) < 2)
  await page.getByRole('button', { name: 'Cerrar biblioteca' }).click()
  await engine(page).evaluate(() => {
    const transfer = new DataTransfer()
    transfer.setData('application/x-cursado-shortcut', JSON.stringify({ name: 'NLM semana 3', url: 'https://notebooklm.google.com/notebook/semana-3' }))
    document.getElementById('board').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 1000, clientY: 250 }))
  })
  const shortcut = engine(page).locator('.komu-text a[href="https://notebooklm.google.com/notebook/semana-3"]')
  await expect(shortcut).toHaveText('NLM semana 3')
  await expect.poll(() => engine(peer).locator('.komu-text a[href="https://notebooklm.google.com/notebook/semana-3"]').count()).toBe(1)
  await context.route('https://notebooklm.google.com/**', route => route.fulfill({ body: 'NotebookLM' }))
  await shortcut.hover({ force: true })
  const popupPromise = page.waitForEvent('popup', {timeout:10000})
  await engine(page).locator('.ctb-link-card').getByRole('link', { name: 'Open', exact: true }).click()
  const popup = await popupPromise
  await popup.waitForURL('https://notebooklm.google.com/notebook/semana-3')
  await popup.close()

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
  const video = engine(page).locator('[data-study=youtube]')
  await engine(page).evaluate(() => {
    window.__komuboard.canvas.setTool('select')
    window.__komuboard.canvas.restoreStudyView({ x: 0, y: 0, zoom: 1 })
    const map = [...window.__komuboard.doc.getMap('objects').values()].find(map => map.get('study')?.kind === 'youtube')
    map.set('x', 100); map.set('y', 100)
  })
  const toolbarWidth = await video.locator('.board-video-toolbar').evaluate(el => el.offsetWidth)
  const header = await video.locator('.study-video-drag').boundingBox()
  await page.mouse.move(header.x + 80, header.y + 10)
  await page.mouse.down(); await page.mouse.move(header.x + 160, header.y + 50, { steps: 8 }); await page.mouse.up()
  await expect.poll(() => engine(page).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].find(map => map.get('study')?.kind === 'youtube').get('x'))).toBeGreaterThan(150)
  await engine(page).evaluate(() => window.__komuboard.canvas.zoomTo(0.25))
  assert.equal(await video.locator('.board-video-toolbar').evaluate(el => el.offsetWidth), toolbarWidth)
  await expect.poll(() => video.locator('.study-video-body').evaluate(el => getComputedStyle(el).transform)).toBe('matrix(0.25, 0, 0, 0.25, 0, 0)')
  await engine(page).evaluate(() => window.__komuboard.canvas.zoomTo(1))
  await send(page, 'insert', { object: { id: '', type: 'text', authorId: 'test', x: 100, y: 400, width: 320, height: 62, runs: [{ text: 'Destino' }], fontFamily: 'system-ui', fontSize: 18, align: 'left', study: { kind: 'board', reference: { boardId: 'local:important-target', name: 'Destino' } } } })
  const boardCard = engine(page).locator('[data-study=board]')
  await expect(boardCard).toBeVisible()
  const boardBox = await boardCard.boundingBox()
  await page.mouse.dblclick(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2)
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
  const converterVersion=await engine(page).evaluate(()=>window.__komuboard.doc.getMap('study-migration').get('report').version)
  await expect.poll(() => page.evaluate(async () => (await window.read('progreso/pizarra-sync/migration-approvals.json')).images)).toBe(converterVersion)
  assert.deepEqual(errors, [])
})

test('diagram chooser previews PlantUML, handles errors, cancels and imports into the board', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }); await fixture(context)
  const page = await context.newPage()
  await page.goto(origin + '/study-fixture?board=first'); await loaded(page)
  // Simulate an update removing the old lazy importer after the board has opened.
  let lateImporterRequests = 0
  await context.route(/\/(?:assets\/study-imports-[^/]+\.js|src\/study-imports\.ts)(?:\?.*)?$/, route => {
    lateImporterRequests++; return route.abort('failed')
  })
  await page.addStyleTag({ path: 'components/study-diagrams.css' })
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click()
  const dock = engine(page).locator('komu-tool-dock')
  await expect(dock.locator('[data-tool="image"]')).toHaveCount(0)
  await expect(dock.getByRole('button', { name: 'PDF fijado', exact: true })).toHaveCount(0)
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 180
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 180)
    ctx.strokeStyle = '#3b6bff'; ctx.lineWidth = 3; ctx.strokeRect(30, 60, 140, 60); ctx.strokeRect(300, 60, 140, 60)
    ctx.beginPath(); ctx.moveTo(170, 90); ctx.lineTo(300, 90); ctx.stroke()
    ctx.fillStyle = '#172033'; ctx.font = '20px sans-serif'; ctx.fillText('Alice', 65, 97); ctx.fillText('Bob', 350, 97)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  let renderCalls = 0
  await context.route('**/api/diagrams/plantuml', async route => {
    renderCalls++
    const { source } = route.request().postDataJSON()
    if (source.includes('invalid')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Syntax Error: line 2' }) })
    if (source.includes('slow')) await new Promise(resolve => setTimeout(resolve, 1800))
    return route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') })
  })
  const initialObjects = await engine(page).evaluate(() => window.__komuboard.doc.getMap('objects').size)
  await dock.getByRole('button', { name: 'Diagramas', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Diagramas', exact: true })
  await expect(dialog.getByRole('button', { name: /Venn/ })).toBeDisabled()
  await dialog.getByRole('button', { name: /PlantUML/ }).click()
  const code = page.getByRole('textbox', { name: 'Código PlantUML' })
  const insert = page.getByRole('button', { name: 'Insertar', exact: true })
  await expect(insert).toBeDisabled(); assert.equal(renderCalls, 0)
  await code.fill('@startuml\nAlice -> Bob: Hola\n@enduml')
  await expect(insert).toBeEnabled()
  const preview = page.getByRole('img', { name: 'Vista previa de PlantUML' })
  await expect.poll(() => preview.evaluate(el => el.naturalWidth)).toBe(480)
  const codeBounds = await code.boundingBox(), previewBounds = await preview.boundingBox()
  assert.ok(codeBounds.x + codeBounds.width < previewBounds.x)
  await page.screenshot({ path: 'test-results/study-diagrams-preview.png' })
  const slowRequest = page.waitForRequest(request => request.url().includes('/api/diagrams/plantuml') && request.postDataJSON().source.includes('slow'))
  await code.fill('@startuml\nAlice -> Bob: slow\n@enduml'); await slowRequest
  await code.fill('@startuml\nAlice -> Bob: latest\n@enduml')
  await expect(insert).toBeEnabled()
  const latestPreview = await preview.getAttribute('src')
  await page.waitForTimeout(1500) // the superseded render finishes after the latest preview
  await expect(preview).toHaveAttribute('src', latestPreview)
  await code.fill('invalid')
  await expect(insert).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('Syntax Error: line 2')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await engine(page).evaluate(() => window.__komuboard.doc.getMap('objects').size), initialObjects)
  await dock.getByRole('button', { name: 'Diagramas', exact: true }).click()
  await page.getByRole('button', { name: /PlantUML/ }).click()
  await code.fill('@startuml\nAlice -> Bob: Listo\n@enduml')
  await expect(insert).toBeEnabled()
  await insert.click()
  await expect(page.getByRole('dialog', { name: 'PlantUML', exact: true })).toHaveCount(0)
  await expect.poll(() => engine(page).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('type') === 'image').length)).toBe(1)
  await page.getByRole('button', { name: 'Volver a Estudio', exact: true }).click()
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click(); await loaded(page)
  await expect.poll(() => engine(page).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('type') === 'image').length)).toBe(1)
  const diagramId = await engine(page).evaluate(() => {
    window.__komuboard.canvas.setTool('select')
    window.__komuboard.canvas.restoreStudyView({ x: 0, y: 0, zoom: 1 })
    const image = [...window.__komuboard.doc.getMap('objects').values()].find(map => map.get('type') === 'image')
    image.set('x',200); image.set('y',300)
    return image.get('id')
  })
  const savedSource = '@startuml\nAlice -> Bob: Listo\n@enduml'
  assert.equal(await engine(page).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).get('plantumlSource'), diagramId), savedSource)
  const imageBox = await engine(page).locator(`.komu-image[data-id="${diagramId}"]`).boundingBox()
  await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2)
  await page.mouse.down()
  await expect(code).toHaveValue(savedSource)
  await page.mouse.up()
  await code.fill('@startuml\nAlice -> Bob: Editado\n@enduml')
  const replace = page.getByRole('button', { name: 'Reinsertar', exact: true })
  await expect(replace).toBeEnabled()
  await replace.click()
  await expect(page.getByRole('dialog', { name: 'PlantUML', exact: true })).toHaveCount(0)
  const updated = await engine(page).evaluate(id => {
    const images = [...window.__komuboard.doc.getMap('objects').values()].filter(map => map.get('type') === 'image')
    return { count:images.length, image:window.__komuboard.doc.getMap('objects').get(id).toJSON() }
  }, diagramId)
  assert.equal(updated.count,1)
  assert.equal(updated.image.plantumlSource,'@startuml\nAlice -> Bob: Editado\n@enduml')
  assert.equal(updated.image.x,200); assert.equal(updated.image.y,300)
  await page.setViewportSize({ width: 390, height: 844 })
  await engine(page).locator('komu-tool-dock').getByRole('button', { name: 'Diagramas', exact: true }).click()
  await page.getByRole('button', { name: /PlantUML/ }).click()
  await expect(code).toBeVisible()
  const mobileCode = await code.boundingBox(), mobilePreview = await page.getByRole('region', { name: 'Vista previa del diagrama' }).boundingBox()
  assert.ok(mobileCode.y + mobileCode.height <= mobilePreview.y)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'PlantUML', exact: true })).toHaveCount(0)
  assert.equal(lateImporterRequests, 0, 'inserting and editing diagrams must not fetch a lazy importer')
})

test('PDF names open on one click and restore their destination after native text editing', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext(); await fixture(context)
  const page = await context.newPage()
  await page.goto(origin + '/study-fixture?board=first'); await loaded(page)
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click()
  const pdf = () => engine(page).locator('[data-study="pdf"]').filter({ hasText: 'Uno.pdf' })
  const id = await pdf().getAttribute('data-id')
  const card = () => engine(page).locator(`.komu-text[data-id="${id}"]:not(.komu-text-editor)`)
  const originalHref = await card().locator('a').getAttribute('href')
  const box = await card().boundingBox()
  // The blank part of the object uses the engine's ordinary text editor.
  await page.mouse.click(box.x + box.width - 25, box.y + box.height / 2)
  const editor = engine(page).locator('.komu-text-editor [contenteditable=true],.komu-text-editor[contenteditable=true]')
  await expect(editor).toBeVisible()
  await editor.fill('Mi resumen de ecuaciones')
  await editor.press('Escape')
  await expect(card().locator('a')).toHaveText('Mi resumen de ecuaciones')
  await expect(card().locator('a')).toHaveAttribute('href', originalHref)
  await card().locator('a').click({ force: true })
  await expect(page.getByTitle('Lector de PDF de la pizarra')).toBeVisible()
  const reader = page.frames().find(frame => frame.url().includes('mode=reader'))
  assert.equal(await reader.evaluate(() => window.reference.materialId), 1)
  await expect(card()).not.toHaveClass(/study-opening/)
  await reader.locator('body').press('Escape')
  await expect(page.getByTitle('Lector de PDF de la pizarra')).toHaveCount(0)
  await page.getByRole('button', { name: 'Volver a Estudio', exact: true }).click()
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click(); await loaded(page)
  await expect(card().locator('a')).toHaveText('Mi resumen de ecuaciones')
  await expect(card().locator('a')).toHaveAttribute('href', originalHref)
})

test('dragged shortcuts use native text links and repair existing saved cards', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext(); await fixture(context)
  const page = await context.newPage()
  await page.goto(origin + '/study-fixture?board=first'); await loaded(page)
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click()
  await engine(page).evaluate(() => {
    const transfer = new DataTransfer()
    transfer.setData('application/x-cursado-shortcut', JSON.stringify({ name: 'nlm', url: 'https://notebooklm.google.com/notebook/native-link' }))
    document.getElementById('board').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 500, clientY: 300 }))
  })
  const link = () => engine(page).locator('.komu-text a[href="https://notebooklm.google.com/notebook/native-link"]')
  await expect(link()).toHaveText('nlm')
  const id = await link().evaluate(el => el.closest('[data-id]').dataset.id)
  const box = await link().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 10 }); await page.mouse.up()
  assert.equal(context.pages().length, 1)
  // Simulate an already saved shortcut from the previous implementation.
  await engine(page).evaluate(id => {
    const map = window.__komuboard.doc.getMap('objects').get(id)
    map.set('study', { kind: 'shortcut', reference: { name: 'nlm', url: 'https://notebooklm.google.com/notebook/native-link' } })
    map.set('runs', [{ text: 'nlm' }])
  }, id)
  await page.getByRole('button', { name: 'Volver a Estudio', exact: true }).click()
  await page.getByRole('button', { name: 'Reabrir', exact: true }).click(); await loaded(page)
  await expect(link()).toHaveText('nlm')
  await context.route('https://notebooklm.google.com/**', route => route.fulfill({ body: 'NotebookLM' }))
  await link().hover({ force: true })
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    engine(page).locator('.ctb-link-card').getByRole('link', { name: 'Open', exact: true }).click(),
  ])
  await popup.waitForURL('https://notebooklm.google.com/notebook/native-link')
})

test('library navigation replaces board sessions instead of accumulating embedded boards', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext(); await fixture(context)
  const page = await context.newPage()
  await page.goto(origin + '/study-fixture?board=first'); await loaded(page)
  for (const boardId of ['second', 'target', 'first']) {
    const accept = page.getByRole('button', { name: 'Aceptar', exact: true })
    if (await accept.isVisible()) await accept.click()
    await engine(page).getByRole('button', { name: 'Agregar a la pizarra' }).click()
    await page.getByRole('button', { name: 'Biblioteca', exact: true }).click()
    const previous = page.frames().find(frame => frame.url().includes('/study-board/index.html'))
    const libraryFrame = page.frames().find(frame => frame.url().includes('/biblioteca/pizarra'))
    await libraryFrame.evaluate(boardId => {
      const params = new URLSearchParams(location.search)
      parent.postMessage({ type: 'board-library:open-board', session: params.get('session'), boardId: params.get('boardId'), reference: { boardId: `local:important-${boardId}`, name: boardId } }, location.origin)
    }, boardId)
    await loaded(page, boardId)
    await expect(page.locator('iframe')).toHaveCount(1)
    await expect.poll(() => previous.isDetached()).toBe(true)
    assert.ok(await page.evaluate(async id => (await window.read(`progreso/pizarra-sync/${id}.json`)).draft, new URL(previous.url()).searchParams.get('topicBoard')))
  }
  await page.getByRole('button', { name: 'Volver a la pizarra anterior' }).click(); await loaded(page, 'target')
  await expect(page.locator('iframe')).toHaveCount(1)
  // The same adapter used by subjects and Important tasks delegates before
  // creating a session when it runs inside the library's React context.
  await page.evaluate(() => window.delegateBoard())
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.delegatedBoard?.boardId)).toBe('local:important-target')
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

test('the saved Pizarra profile persists through board changes, reloads and edits in another tab', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext(); await fixture(context)
  await context.addInitScript(() => {
    if (!localStorage.getItem('pizarra-perfil-copia')) {
      localStorage.setItem('pizarra-perfil-copia', JSON.stringify({id:'previous-account',display_name:'Rafa',color:'#123456'}))
      localStorage.setItem('komuboard-name','Auburn Gecko')
      localStorage.setItem('komuboard-grid','lines')
    }
  })
  const page = await context.newPage()
  await page.goto(origin + '/study-fixture?defer=1'); await page.waitForFunction(() => window.openBoard)
  await page.evaluate(() => window.openBoard('profile-first')); await loaded(page)
  const openProfile = async page => {
    await engine(page).locator('#nav-toggle').click()
    await engine(page).locator('.app-menu [data-act=profile]').click()
    await expect(engine(page).locator('#profile-name')).toBeVisible()
  }
  await openProfile(page)
  await expect(engine(page).locator('#profile-name')).toHaveValue('Rafa')
  await engine(page).locator('#profile-name').fill('Rafael')
  const selectedColor = await engine(page).locator('#profile-swatches button').first().getAttribute('data-color')
  await engine(page).locator('#profile-swatches button').first().click()
  await engine(page).locator('#profile-save').click()
  await page.evaluate(() => window.openBoard('profile-second')); await loaded(page, 'profile-second')
  await openProfile(page)
  await expect(engine(page).locator('#profile-name')).toHaveValue('Rafael')
  assert.equal(await engine(page).evaluate(() => document.getElementById('board').dataset.grid), 'lines')
  await engine(page).locator('#profile-save').click()
  await page.reload(); await page.waitForFunction(() => window.openBoard)
  await page.evaluate(() => window.openBoard('profile-second')); await loaded(page)
  await openProfile(page)
  await expect(engine(page).locator('#profile-name')).toHaveValue('Rafael')
  assert.equal(await engine(page).locator('#profile-swatches button.on').getAttribute('data-color'),selectedColor)
  await engine(page).locator('#profile-save').click()
  const peer = await context.newPage()
  await peer.goto(origin + '/study-fixture?defer=1'); await peer.waitForFunction(() => window.openBoard)
  await peer.evaluate(() => window.openBoard('profile-peer')); await loaded(peer)
  await engine(peer).locator('#nav-toggle').click()
  await openProfile(page)
  await engine(page).locator('#profile-name').fill('Rafa persistente')
  await engine(page).locator('#profile-save').click()
  await expect(engine(peer).locator('.app-menu [data-profile-name]')).toHaveText('Rafa persistente')
})

test('cooperative container opens the same live room across independent devices', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const ownerContext = await browser.newContext(), receiverContext = await browser.newContext()
  await fixture(ownerContext); await fixture(receiverContext)
  const a = await ownerContext.newPage(), b = await receiverContext.newPage(), sphereId = crypto.randomUUID()
  for (const page of [a,b]) { await page.goto(origin + '/study-fixture?defer=1'); await page.waitForFunction(() => window.openCooperativeBoard) }
  await b.evaluate(sphereId => window.openCooperativeBoard({sphereId,owner:false}), sphereId)
  await loaded(b)
  await a.evaluate(sphereId => window.openCooperativeBoard({sphereId,owner:true}), sphereId)
  await loaded(a)
  assert.equal(new URL(engine(a).url()).searchParams.get('room'), new URL(engine(b).url()).searchParams.get('room'))
  await send(a, 'insert', {object:{type:'text',runs:[{text:'Trabajo compartido'}],width:200,height:50,x:100,y:100}})
  await expect.poll(() => engine(b).evaluate(() => window.__komuboard.doc.getMap('objects').size)).toBe(1)
  const objectId = await engine(b).evaluate(() => [...window.__komuboard.doc.getMap('objects').keys()][0])
  await engine(b).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).set('x',450), objectId)
  await expect.poll(() => engine(a).evaluate(id => window.__komuboard.doc.getMap('objects').get(id).get('x'),objectId)).toBe(450)
  await b.reload(); await b.waitForFunction(() => window.openCooperativeBoard)
  await b.evaluate(sphereId => window.openCooperativeBoard({sphereId,owner:false}), sphereId)
  await loaded(b)
  await expect.poll(() => engine(b).evaluate(id => window.__komuboard.doc.getMap('objects').get(id)?.get('x'),objectId)).toBe(450)
})

test('study URL reload restores the current nested board and closing clears its location', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context)
  await context.route(/\/(?:estudio|imp|pizarra\/[^/]+\/[^/]+\/[^/?]+)(?:\?|$)/, route => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}.fixed{position:fixed}.absolute{position:absolute}.top-3{top:12px}.left-3{left:12px}.inset-0{inset:0}.h-full{height:100%}.w-full{width:100%}.flex{display:flex}iframe{border:0}</style><div id="root"></div><script type="module" src="/study-parent.js"></script>' }))
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/estudio?persist=1&untouched=yes#anchor')
  await page.getByRole('button', { name: 'Abrir pizarra', exact: true }).click(); await loaded(page, 'route-first')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/pizarra/base-de-datos/4/temas')
  assert.equal(new URL(page.url()).searchParams.has('pizarra'), false)
  await send(page, 'insert', { object: { type: 'text', authorId: 'test', x: 100, y: 400, width: 320, height: 62, runs: [{ text: 'Destino' }], fontFamily: 'system-ui', fontSize: 18, align: 'left', study: { kind: 'board', reference: { boardId: 'local:important-route-second', name: 'Base de Datos · temas', topic: { cooperationWeekNumber: 5 } } } } })
  await engine(page).evaluate(() => { window.__komuboard.canvas.setTool('select'); window.__komuboard.canvas.restoreStudyView({ x: 0, y: 0, zoom: 1 }) })
  const box = await engine(page).locator('[data-study=board]').boundingBox()
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2); await loaded(page, 'route-second')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/pizarra/base-de-datos/5/temas')
  await expect.poll(async () => page.evaluate(async () => { try { return (await window.read('progreso/rutas-estudio.json')).routes['/pizarra/base-de-datos/5/temas']?.key } catch { return null } })).toBe('board:route-second')
  await page.evaluate(() => { sessionStorage.clear(); history.replaceState(null, '') })
  await page.reload(); await loaded(page, 'route-second')
  await expect(page.getByRole('dialog', { name: 'Pizarra de Base de Datos · temas', exact: true })).toHaveCount(1)
  const direct = await context.newPage(); await direct.goto(page.url()); await loaded(direct, 'route-second'); await direct.close()
  assert.equal(new URL(page.url()).searchParams.get('untouched'), 'yes'); assert.equal(new URL(page.url()).hash, '#anchor')
  await page.getByRole('button', { name: 'Volver a Estudio', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/estudio')
  await page.evaluate(() => window.openNamedBoard('route-third', 5)); await loaded(page, 'route-third')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/pizarra/base-de-datos/5/temas-2')
  await page.reload(); await loaded(page, 'route-third')
  await page.getByRole('button', { name: 'Volver a Estudio', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/estudio')
  await page.reload(); await expect(page.getByRole('button', { name: 'Abrir pizarra', exact: true })).toBeVisible()
  assert.equal(engine(page), undefined)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/imp')
  await expect(page.getByRole('heading', { name: 'Importantes', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Importantes', exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
})

test('dense Study board composites zoom and pan frames, then restores crisp geometry and editing', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context)
  await context.route('**/img/zoom-diagram.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="8192"><rect width="4096" height="8192" fill="white"/><path d="M0 0L4096 8192" stroke="black"/></svg>' }))
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/study-fixture?defer=1'); await page.waitForFunction(() => window.openBoard)
  await page.evaluate(() => window.openBoard('dense-zoom')); await loaded(page)
  const frame = engine(page)
  await frame.evaluate(() => {
    const { doc, canvas } = window.__komuboard, objects = doc.getMap('objects')
    doc.transact(() => {
      const order = []
      for (let index = 0; index < 240; index++) {
        const id = 'dense-' + index, map = new objects.constructor()
        objects.set(id, map)
        const value = { id, type: 'text', authorId: 'test', x: 80 + index % 20 * 60, y: 130 + Math.floor(index / 20) * 48, width: 58, height: 30, fontSize: 12, fontFamily: 'system-ui', align: 'left', runs: [{ text: 'Elemento ' + index }] }
        for (const [key, entry] of Object.entries(value)) map.set(key, entry)
        order.push(id)
      }
      for (let index = 0; index < 4; index++) {
        const id = 'zoom-image-' + index, map = new objects.constructor()
        objects.set(id, map)
        for (const [key, value] of Object.entries({ id, type: 'image', authorId: 'test', src: 'zoom-diagram.svg', x: 1800 + index * 250, y: 200, width: 200, height: 400 })) map.set(key, value)
        order.push(id)
      }
      doc.getArray('order').push(order)
    })
    canvas.setTool('select'); canvas.restoreStudyView({ x: 0, y: 0, zoom: 1 })
  })
  const element = frame.locator('[data-id="dense-100"]'), layer = frame.locator('.text-layer')
  await expect(element).toBeVisible()
  const original = await element.getAttribute('style')
  await frame.evaluate(() => {
    window.childCameraWrites = 0
    window.cameraObserver = new MutationObserver(records => { window.childCameraWrites += records.filter(record => record.target !== document.querySelector('.text-layer') && record.attributeName === 'style').length })
    window.cameraObserver.observe(document.querySelector('.text-layer'), { subtree: true, attributes: true, attributeFilter: ['style'] })
  })
  const iframeBox = await page.locator('iframe').first().boundingBox()
  await page.mouse.move(iframeBox.x + 700, iframeBox.y + 500)
  const during = await frame.evaluate(async () => {
    const target = document.querySelector('.konvajs-content canvas')
    for (let step = 0; step < 5; step++) {
      target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 700, clientY: 500, deltaY: -30 }))
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return { writes: window.childCameraWrites, style: document.querySelector('[data-id="dense-100"]').getAttribute('style'), transform: document.querySelector('.text-layer').style.transform, moving: document.querySelector('.text-layer').dataset.cameraMotion }
  })
  assert.equal(during.moving, 'true')
  assert.equal(during.style, original)
  assert.equal(during.writes, 0)
  assert.notEqual(during.transform, '')
  await expect(layer).not.toHaveAttribute('data-camera-motion', 'true')
  const geometry = await frame.evaluate(() => {
    const { canvas, doc } = window.__komuboard, view = canvas.captureStudyReviewView(), el = document.querySelector('[data-id="dense-100"]'), rect = el.getBoundingClientRect()
    return { zoom: view.zoom, width: rect.width, styleWidth: parseFloat(el.style.width), sourceWidth: doc.getMap('objects').get('dense-100').get('width') }
  })
  assert.ok(Math.abs(geometry.width - geometry.sourceWidth * geometry.zoom) < 1)
  assert.ok(Math.abs(geometry.styleWidth - geometry.sourceWidth * geometry.zoom) < .01)
  // Large camera changes must mount newly visible images rather than leave holes.
  await frame.evaluate(() => window.__komuboard.canvas.restoreStudyView({ x: 0, y: 0, zoom: .4 }))
  await expect(frame.locator('.komu-image')).toHaveCount(4)
  await frame.evaluate(() => { window.cameraObserver.disconnect(); window.__komuboard.canvas.setTool('hand') })
  await page.mouse.move(iframeBox.x + 700, iframeBox.y + 700); await page.mouse.down()
  await page.mouse.move(iframeBox.x + 800, iframeBox.y + 750, { steps: 5 })
  await expect(layer).toHaveAttribute('data-camera-motion', 'true')
  await page.mouse.up(); await expect(layer).not.toHaveAttribute('data-camera-motion', 'true')
  // A new pointer action immediately flushes the preview before selection/hit testing.
  await page.mouse.wheel(0, -30); await expect(layer).toHaveAttribute('data-camera-motion', 'true')
  await frame.evaluate(() => window.__komuboard.canvas.setTool('select'))
  await expect(layer).not.toHaveAttribute('data-camera-motion', 'true')
  await page.mouse.wheel(0, -30); await expect(layer).toHaveAttribute('data-camera-motion', 'true')
  const updated = await frame.evaluate(() => {
    const { canvas, doc } = window.__komuboard
    doc.getMap('objects').get('dense-100').set('x', 130)
    const view = canvas.worldViewport(), zoom = canvas.captureStudyReviewView().zoom
    return { left: parseFloat(document.querySelector('[data-id="dense-100"]').style.left), expected: (130 - view.x) * zoom }
  })
  await expect(layer).not.toHaveAttribute('data-camera-motion', 'true')
  assert.ok(Math.abs(updated.left - updated.expected) < .01)
  assert.deepEqual(errors, [])
})

test('image reader opens on double click, loads one image at a time and returns without editing the board', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await fixture(context)
  const requests = [], errors = []
  await context.route('**/img/reader-*', route => {
    if (route.request().frame().parentFrame() === null) {
      const name = route.request().url().split('/').at(-1)
      requests.push(name)
      if (name === 'reader-third.svg') return route.fulfill({ status: 404, body: '' })
    }
    return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="8192"><rect width="4096" height="8192" fill="white"/><text x="500" y="500" font-size="100">Diagrama grande</text></svg>' })
  })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/study-fixture?defer=1'); await page.waitForFunction(() => window.openBoard)
  await page.evaluate(() => window.openBoard('image-reader')); await loaded(page)
  for (const [index, src] of ['reader-first.svg', 'reader-second.svg', 'reader-third.svg'].entries()) {
    await send(page, 'insert', { object: { type: 'image', src, x: 200 + index * 500, y: 300, width: 300, height: 150, rotation: 0, ...(index === 0 ? { plantumlSource: '@startuml\nA -> B\n@enduml' } : {}) } })
  }
  const frame = engine(page)
  await expect(frame.locator('.komu-image')).toHaveCount(3)
  await frame.evaluate(() => { window.__komuboard.canvas.setTool('select'); window.__komuboard.canvas.restoreStudyView({ x: 0, y: 0, zoom: 1 }) })
  const before = await frame.evaluate(() => JSON.stringify([...window.__komuboard.doc.getMap('objects').values()].map(map => map.toJSON())))
  const image = frame.locator('.komu-image').first(), box = await image.boundingBox()
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  const reader = page.getByRole('dialog', { name: 'Visor de imágenes de la pizarra', exact: true })
  await expect(reader).toBeVisible()
  assert.deepEqual(await reader.boundingBox(), { x: 0, y: 0, width: 1440, height: 1000 })
  await expect(reader.getByText('Imagen 1 de 3', { exact: true })).toBeVisible()
  await expect.poll(() => requests).toEqual(['reader-first.svg'])
  await expect(reader.getByText('Cargando imagen…')).toHaveCount(0)
  const painted = () => reader.locator('[data-study-image-viewer] canvas').evaluateAll(canvases => canvases.some(canvas => {
    const context = canvas.getContext('2d')
    if (!context || !canvas.width || !canvas.height) return false
    const pixel = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    return pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240 && pixel[3] > 240
  }))
  await expect.poll(painted).toBe(true)
  await expect(reader.getByRole('button')).toHaveCount(1)
  assert.equal(await reader.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)')
  const surface = reader.locator('[data-study-image-viewer]')
  await expect(surface).toHaveAttribute('data-render-mode', 'detail')
  const initialTransform = await reader.locator('[data-study-image-preview]').evaluate(canvas => canvas.style.transform)
  await page.evaluate(() => {
    window.readerDetailDraws = 0
    const original = CanvasRenderingContext2D.prototype.drawImage
    window.restoreReaderDraw = () => { CanvasRenderingContext2D.prototype.drawImage = original }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (document.querySelector('[data-study-image-viewer]')?.contains(this.canvas)) window.readerDetailDraws++
      return Reflect.apply(original, this, args)
    }
  })
  await page.mouse.move(700, 500); await page.mouse.wheel(0, -300)
  await expect(surface).toHaveAttribute('data-render-mode', 'preview')
  for (let step = 0; step < 6; step++) await page.mouse.wheel(0, -40)
  assert.equal(await page.evaluate(() => window.readerDetailDraws), 0)
  assert.notEqual(await reader.locator('[data-study-image-preview]').evaluate(canvas => canvas.style.transform), initialTransform)
  assert.ok(await reader.locator('[data-study-image-preview]').evaluate(canvas => Math.max(canvas.width, canvas.height) <= 2048))
  await expect(surface).toHaveAttribute('data-render-mode', 'detail')
  assert.ok(await page.evaluate(() => window.readerDetailDraws) > 0)
  await page.evaluate(() => { window.readerDetailDraws = 0 })
  await page.mouse.move(700, 500); await page.mouse.down()
  await page.mouse.move(900, 600, { steps: 10 })
  await expect(surface).toHaveAttribute('data-render-mode', 'preview')
  assert.equal(await page.evaluate(() => window.readerDetailDraws), 0)
  await page.mouse.up()
  await expect(surface).toHaveAttribute('data-render-mode', 'detail')
  assert.ok(await page.evaluate(() => window.readerDetailDraws) > 0)
  await page.evaluate(() => window.restoreReaderDraw())
  assert.deepEqual(requests, ['reader-first.svg'])
  await page.keyboard.press('ArrowRight')
  await expect(reader.getByText('Imagen 2 de 3', { exact: true })).toBeVisible()
  await expect.poll(() => requests).toEqual(['reader-first.svg', 'reader-second.svg'])
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => requests).toEqual(['reader-first.svg', 'reader-second.svg', 'reader-third.svg'])
  await expect(reader.getByRole('status')).toContainText('No se pudo cargar la imagen')
  await page.keyboard.press('ArrowRight')
  await expect(reader.getByText('Imagen 3 de 3', { exact: true })).toHaveCount(1)
  await page.keyboard.press('ArrowLeft')
  await expect(reader.getByText('Imagen 2 de 3', { exact: true })).toBeVisible()
  await expect(reader.getByRole('status')).toHaveCount(0)
  await page.keyboard.press('Tab')
  assert.equal(await reader.evaluate(element => element.contains(document.activeElement)), true)
  await page.keyboard.press('Escape'); await expect(reader).toHaveCount(0)
  await expect.poll(() => frame.evaluate(() => document.hasFocus())).toBe(true)
  assert.equal(await frame.evaluate(() => JSON.stringify([...window.__komuboard.doc.getMap('objects').values()].map(map => map.toJSON()))), before)
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await expect(reader).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.deepEqual(await reader.boundingBox(), { x: 0, y: 0, width: 390, height: 844 })
  await expect(reader.getByRole('status')).toHaveCount(0)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect.poll(painted).toBe(true)
  await page.screenshot({ path: 'test-results/study-image-reader-mobile.png' })
  await reader.getByRole('button', { name: 'Volver a la pizarra', exact: true }).click()
  await expect(reader).toHaveCount(0)
  assert.deepEqual(errors, [])
})

test('a mixed file batch imports later PDFs and releases the importer after reporting failures', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const context = await browser.newContext(); await fixture(context)
  const page = await context.newPage()
  await page.goto(origin + '/study-fixture?defer=1'); await page.waitForFunction(() => window.openBoard)
  await page.evaluate(() => window.openBoard('mixed-import')); await loaded(page)
  await page.locator('input[type=file]').setInputFiles([
    {name:'before.pdf',mimeType:'application/pdf',buffer:onePagePdf()},
    {name:'unsupported.txt',mimeType:'text/plain',buffer:Buffer.from('no compatible')},
    {name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('dañado')},
    {name:'after.pdf',mimeType:'application/pdf',buffer:onePagePdf()},
  ])
  await expect.poll(() => engine(page).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map=>map.get('type')==='image').length),{timeout:30000}).toBe(2)
  await expect(page.getByText(/unsupported\.txt[\s\S]*broken\.pdf/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({name:'next.csv',mimeType:'text/csv',buffer:Buffer.from('a,b\n1,2')})
  await expect.poll(() => engine(page).evaluate(() => [...window.__komuboard.doc.getMap('objects').values()].filter(map=>map.get('study')?.kind==='table').length)).toBe(1)
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


test('review markers migrate and repair accepted placeholders; countdown and marker geometry follows zoom', { timeout: 120000 }, async t => {
  const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome'}); t.after(()=>browser.close())
  const context=await browser.newContext({viewport:{width:1440,height:1000}}); await fixture(context)
  const page=await context.newPage(); await page.goto(origin+'/study-fixture?board=review'); await loaded(page)
  await expect(page.getByText('Elemento anterior: shapes:review-marker')).toHaveCount(0)
  await page.getByRole('button',{name:'Aceptar',exact:true}).click()
  const frame=engine(page), marker=frame.locator('[data-study=review]'), counter=frame.locator('[data-study=important]')
  await expect(marker).toHaveCount(1); await expect(counter.locator('.study-card-label')).toHaveText(/^\d+d$/)
  const sizes=[]
  for(const zoom of [1,.25,2]) {
    await frame.evaluate(zoom=>window.__komuboard.canvas.restoreStudyView({x:0,y:0,zoom}),zoom)
    await expect.poll(()=>marker.evaluate(el=>parseFloat(el.style.width))).toBe(56*zoom)
    sizes.push(await Promise.all([marker.boundingBox(),counter.boundingBox(),frame.locator('[data-shape=rectangle]').boundingBox()]))
  }
  for(let i=0;i<3;i++) for(const [index,ratio] of [[1,.25],[2,2]]) {
    assert.ok(Math.abs(sizes[index][i].width/sizes[0][i].width-ratio)<.02)
    assert.ok(Math.abs(sizes[index][i].height/sizes[0][i].height-ratio)<.02)
  }
  await frame.evaluate(()=>window.__komuboard.canvas.restoreStudyView({x:0,y:0,zoom:1}))
  await marker.getByRole('button',{name:'Ir al repaso'}).click()
  const view=await frame.evaluate(()=>window.__komuboard.canvas.captureStudyReviewView())
  assert.ok(Math.abs(view.center.x-500)<.01); assert.ok(Math.abs(view.center.y-400)<.01)
  const original={id:'old',kind:'circle',visualType:'review-marker',x:250,y:300,width:56,height:56,color:'#202020'}
  await send(page,'insert',{object:{id:'repair-me',type:'text',authorId:'test',x:280,y:330,width:320,height:62,runs:[{text:'Old placeholder'}],fontFamily:'system-ui',fontSize:18,align:'left',study:{kind:'legacy',original},legacyOriginal:original}})
  await frame.locator('[data-study=legacy]').waitFor()
  const repairedId=await frame.locator('[data-study=legacy]').getAttribute('data-id')
  await page.getByRole('button',{name:/Volver a Estudio/}).click()
  await expect(page.getByRole('button',{name:'Reabrir',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Reabrir',exact:true}).click(); await loaded(page)
  await expect(engine(page).locator(`[data-id="${repairedId}"][data-study=review]`)).toHaveCount(1)
  const repaired=await engine(page).evaluate(id=>window.__komuboard.doc.getMap('objects').get(id).toJSON(),repairedId)
  assert.equal(repaired.x,280); assert.equal(repaired.y,330); assert.equal(repaired.width,56)
  await expect(page.getByText('Elemento anterior: shapes:review-marker')).toHaveCount(0)
})
