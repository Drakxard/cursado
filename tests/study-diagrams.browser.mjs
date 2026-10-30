import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'
import nextConfig from '../next.config.mjs'

test('study dialog renders local mindmaps with separate KaTeX rows and inserts the preview PNG', { timeout: 90000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {createRoot} from 'react-dom/client';
    import {StudyDiagramsDialog} from './components/study-diagrams-dialog';
    createRoot(document.getElementById('root')).render(<StudyDiagramsDialog onClose={()=>window.closedDialog=true} onInsert={async(file,source)=>{window.inserted={source,type:file.type,size:file.size,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))}}}/>);
  `, loader: 'tsx' }, bundle: true, format: 'esm', write: false, jsx: 'automatic', loader: { '.css': 'empty' } })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const context = await browser.newContext()
  await context.route('http://study.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/fixture.js"></script>' })
    if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (path === '/plantuml-renderer.html') return route.fulfill({ contentType: 'text/html', body: await readFile('public/pizarra/plantuml.html') })
    if (path.startsWith('/pizarra/') && !path.includes('..')) {
      const extension = path.split('.').at(-1)
      return route.fulfill({ body: await readFile('public' + path), contentType: { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' }[extension] || 'application/octet-stream' })
    }
    return route.fulfill({ status: 501, body: 'Endpoint deshabilitado en modo local.' })
  })
  await context.addInitScript(() => {
    window.formulaRows = []
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.dataset.plantumlLabel) continue
        window.parent.formulaRows.push([...node.children].map(row => ({ kind: row.dataset.plantumlRow, math: !!row.querySelector('.katex-display'), top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom })))
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const page = await context.newPage()
  let apiCalls = 0
  page.on('request', request => { if (request.url().includes('/api/')) apiCalls++ })
  await page.goto('http://study.test/')
  await page.addStyleTag({ path: 'components/study-diagrams.css' })
  await page.getByRole('button', { name: /PlantUML/ }).click()
  await expect(page.locator('.study-diagrams-help')).toHaveCount(0)
  await page.evaluate(() => {
    window.copiedPrompts = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedPrompts.push(text) } } })
  })
  const copyPrompt = page.getByRole('button', { name: 'Copiar prompt de PlantUML', exact: true })
  await copyPrompt.click()
  assert.deepEqual(await page.evaluate(() => window.copiedPrompts), ['Puedes expresar  los temas y subtemas, solo sus nombres e implicaciones en PlantUML Mindmap, cómo arbol de implicaciones horizontal.'])
  const copyBounds = await copyPrompt.boundingBox()
  await page.mouse.move(copyBounds.x + copyBounds.width / 2, copyBounds.y + copyBounds.height / 2)
  await page.mouse.down()
  const promptText = page.getByRole('textbox', { name: 'Prompt de PlantUML', exact: true })
  await expect(promptText).toBeFocused()
  await page.mouse.up()
  assert.equal(await page.evaluate(() => window.copiedPrompts.length), 1)
  await promptText.fill('Mi prompt personalizado')
  await page.getByRole('button', { name: 'Guardar prompt', exact: true }).click()
  await copyPrompt.click()
  assert.deepEqual(await page.evaluate(() => window.copiedPrompts), ['Puedes expresar  los temas y subtemas, solo sus nombres e implicaciones en PlantUML Mindmap, cómo arbol de implicaciones horizontal.', 'Mi prompt personalizado'])
  assert.equal(await page.evaluate(() => localStorage.getItem('cursado-plantuml-prompt')), 'Mi prompt personalizado')
  await copyPrompt.press('F2')
  await expect(promptText).toHaveValue('Mi prompt personalizado')
  await promptText.fill('Cambio descartado')
  await promptText.press('Escape')
  await expect(promptText).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'PlantUML', exact: true })).toBeVisible()
  const code = page.getByRole('textbox', { name: 'Código PlantUML' })
  await code.fill('@startmindmap\n* Raíz\n*** Falta un nivel\n@endmindmap')
  await expect(page.getByRole('alert')).toContainText('nivel intermedio')
  const source = String.raw`@startmindmap
* Variación de parámetros
** Forma: $y'+P(x)y=f(x)$ y solución
** Resultado: \(\frac{1}{2}\) y $$x^2$$
@endmindmap`
  await code.fill(source)
  const progressBar = page.getByRole('progressbar', { name: 'Renderizado del diagrama' })
  await expect(progressBar).toBeVisible()
  assert.equal(await progressBar.locator('div').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(34, 197, 94)')
  const insert = page.getByRole('button', { name: 'Insertar', exact: true })
  await expect.poll(async () => {
    if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').textContent())
    return insert.isEnabled()
  }, { timeout: 60000 }).toBe(true)
  const rows = await page.evaluate(() => window.formulaRows)
  assert.equal(rows.flat().filter(row => row.math).length, 3)
  assert.deepEqual(rows[1].map(row => row.kind), ['text', 'math', 'text'])
  for (const label of rows) for (let i = 1; i < label.length; i++) assert.ok(label[i].top >= label[i - 1].bottom)
  const preview = page.getByRole('img', { name: 'Vista previa de PlantUML' })
  await expect.poll(() => preview.evaluate(image => image.naturalWidth)).toBeGreaterThan(100)
  const fittedWidth = (await preview.boundingBox()).width
  await page.getByRole('button', { name: 'Acercar vista previa', exact: true }).click()
  await expect.poll(async () => (await preview.boundingBox()).width).toBeGreaterThan(fittedWidth * 1.3)
  await page.getByRole('button', { name: 'Ver píxeles originales', exact: true }).click()
  await expect.poll(async () => Math.round((await preview.boundingBox()).width)).toBe(await preview.evaluate(image => image.naturalWidth))
  const region = page.getByRole('region', { name: 'Vista previa del diagrama' })
  const initialWidth = (await region.boundingBox()).width
  await page.getByRole('button', { name: 'Maximizar vista previa', exact: true }).click()
  await expect.poll(async () => (await region.boundingBox()).width).toBeGreaterThan(initialWidth * 1.5)
  await expect(code).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(code).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'PlantUML', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 667 })
  await page.getByRole('button', { name: 'Maximizar vista previa', exact: true }).click()
  await page.getByRole('button', { name: 'Ajustar', exact: true }).click()
  const explorer = page.getByLabel('Explorar diagrama', { exact: true })
  await explorer.hover(); await page.mouse.wheel(0,-300)
  await page.getByRole('button', { name: 'Ver píxeles originales', exact: true }).click()
  const exploreBounds = await explorer.boundingBox()
  await page.mouse.move(exploreBounds.x + exploreBounds.width / 2, exploreBounds.y + exploreBounds.height / 2)
  await page.mouse.down(); await page.mouse.move(exploreBounds.x + 20, exploreBounds.y + 20, { steps: 4 }); await page.mouse.up()
  assert.ok(await explorer.evaluate(node => node.scrollTop > 0 || node.scrollLeft > 0))
  await page.getByRole('button', { name: 'Restaurar vista previa', exact: true }).click()
  const bytes = await preview.evaluate(async image => Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())))
  await insert.click()
  assert.deepEqual(await page.evaluate(() => window.inserted.bytes), bytes)
  assert.equal(await page.evaluate(() => window.inserted.source), source)
  assert.equal(await page.evaluate(() => window.closedDialog), true)
  assert.equal(apiCalls, 0)
  assert.equal(await page.locator('iframe').count(), 0)
})

test('exact variation of parameters map completes on mobile with an older board service worker installed', { timeout: 90000 }, async t => {
  const source = await readFile('tests/fixtures/variation-parameters-mindmap.txt', 'utf8')
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {renderStudyMindmap} from './lib/client/study-plantuml';
    import {uploadImage} from './pizarra-sync/packages/client-web/src/uploads';
    window.progress=[];
    window.render=source=>renderStudyMindmap(source,new AbortController().signal,(percent,stage)=>window.progress.push({percent,stage}));
    window.roundtrip=async(blob,preserveResolution)=>{
      const file=new File([blob],'diagrama-plantuml.png',{type:'image/png'});
      let posted;
      const original=window.fetch;
      window.fetch=async(url,options)=>{posted=options.body;return Response.json({key:'diagram.png'})};
      try{
        await uploadImage(file,{preserveResolution});
        const bitmap=await createImageBitmap(posted);
        const width=bitmap.width,height=bitmap.height;bitmap.close();
        const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await value.arrayBuffer()))).join(',');
        return {width,height,unchanged:await hash(posted)===await hash(file)};
      }finally{window.fetch=original}
    };
  ` }, bundle: true, format: 'esm', write: false, define: { 'import.meta.env.VITE_WORKER_HOST': '"127.0.0.1:8787"' } })
  const rewrites = (await nextConfig.rewrites()).beforeFiles
  const mime = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' }
  const server = createServer(async (request, response) => {
    try {
      let path = new URL(request.url, 'http://localhost').pathname
      if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<script type="module" src="/fixture.js"></script>'); return }
      if (path === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
      if (path === '/pizarra/legacy-sw.js') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(`self.addEventListener('install',()=>self.skipWaiting());
          self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
          self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(new Response('<p>Legacy board shell</p>',{headers:{'Content-Type':'text/html'}}))});`)
        return
      }
      path = rewrites.find(rule => rule.source === path)?.destination || path
      if (!path.startsWith('/pizarra/') || path.includes('..')) { response.writeHead(404).end(); return }
      response.setHeader('Content-Type', mime[path.split('.').at(-1)] || 'application/octet-stream')
      response.end(await readFile('public' + path))
    } catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })
  await context.addInitScript(() => {
    window.renderedLabels = 0
    window.labelInk = []
    const draw = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      if (image instanceof HTMLCanvasElement && args.length === 4) {
        const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data
        let ink = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) ink++
        window.parent.labelInk.push(ink)
      }
      return draw.call(this, image, ...args)
    }
    window.labelFrameWaits = 0
    const frame = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = callback => {
      if (document.querySelector('[data-plantuml-label]')) window.parent.labelFrameWaits++
      return frame(callback)
    }
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.dataset.plantumlLabel) window.parent.renderedLabels++
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/pizarra/legacy-sw.js', { scope: '/pizarra/' })
    const worker = registration.installing || registration.waiting || registration.active
    if (worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve() }))
    const probe = document.createElement('iframe')
    probe.src = '/pizarra/plantuml.html'
    document.body.append(probe)
    await new Promise(resolve => probe.onload = resolve)
    if (!probe.contentDocument.body.textContent.includes('Legacy board shell')) throw new Error('Legacy cache was not reproduced')
    probe.remove()
  })
  const started = Date.now()
  const result = await page.evaluate(async source => {
    const blob = await window.render(source)
    const image = new Image()
    image.src = URL.createObjectURL(blob)
    await image.decode()
    document.body.append(image)
    image.style.width = '100%'
    const stored=await window.roundtrip(blob,true)
    const photo=await window.roundtrip(blob,false)
    return { type: blob.type, size: blob.size, width: image.naturalWidth, height: image.naturalHeight, stored, photo }
  }, source)
  t.diagnostic(`Exact map rendered in ${Date.now() - started} ms: ${JSON.stringify(result)}`)
  assert.equal(result.type, 'image/png')
  assert.ok(result.size > 10000)
  assert.ok(result.width > 100 && result.height > 100)
  assert.ok(result.width <= 8192 && result.height <= 8192)
  assert.ok(result.width * result.height <= 32_000_000)
  assert.ok(Math.max(result.width, result.height) > 6000, 'large maps need extra resolution for zoom')
  assert.deepEqual(result.stored, { width: result.width, height: result.height, unchanged: true })
  assert.equal(Math.max(result.photo.width, result.photo.height), 2048, 'ordinary image uploads retain their existing limit')
  const progress=await page.evaluate(() => window.progress)
  assert.equal(progress.at(-1).percent,100)
  assert.ok(progress.some(item=>item.percent>=35&&item.percent<=65))
  assert.ok(progress.some(item=>item.percent>=70&&item.percent<=95))
  assert.ok(progress.every((item,index)=>index===0||item.percent>=progress[index-1].percent))
  assert.equal(await page.evaluate(() => window.renderedLabels), source.split('\n').filter(line => /^\*+ /.test(line)).length)
  assert.equal(await page.evaluate(() => window.labelFrameWaits), 0, 'label conversion must not wait for throttled offscreen animation frames')
  const ink = await page.evaluate(() => window.labelInk)
  assert.equal(ink.length, await page.evaluate(() => window.renderedLabels))
  assert.ok(ink.every(count => count > 20), 'every cropped label must contain visible text or formulas')
  assert.equal(await page.locator('iframe').count(), 0)
})
