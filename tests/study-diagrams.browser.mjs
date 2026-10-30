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
    createRoot(document.getElementById('root')).render(<StudyDiagramsDialog onClose={()=>window.closedDialog=true} onInsert={async file=>{window.inserted={type:file.type,size:file.size,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))}}}/>);
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
  const insert = page.getByRole('button', { name: 'Insertar', exact: true })
  await expect(insert).toBeEnabled({ timeout: 60000 })
  const rows = await page.evaluate(() => window.formulaRows)
  assert.equal(rows.flat().filter(row => row.math).length, 3)
  assert.deepEqual(rows[1].map(row => row.kind), ['text', 'math', 'text'])
  for (const label of rows) for (let i = 1; i < label.length; i++) assert.ok(label[i].top >= label[i - 1].bottom)
  const preview = page.getByRole('img', { name: 'Vista previa de PlantUML' })
  await expect.poll(() => preview.evaluate(image => image.naturalWidth)).toBeGreaterThan(100)
  const bytes = await preview.evaluate(async image => Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())))
  await insert.click()
  assert.deepEqual(await page.evaluate(() => window.inserted.bytes), bytes)
  assert.equal(await page.evaluate(() => window.closedDialog), true)
  assert.equal(apiCalls, 0)
  assert.equal(await page.locator('iframe').count(), 0)
})

test('exact variation of parameters map completes on mobile with an older board service worker installed', { timeout: 90000 }, async t => {
  const source = await readFile('tests/fixtures/variation-parameters-mindmap.txt', 'utf8')
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {renderStudyMindmap} from './lib/client/study-plantuml';
    window.render=source=>renderStudyMindmap(source,new AbortController().signal);
  ` }, bundle: true, format: 'esm', write: false })
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
    return { type: blob.type, size: blob.size, width: image.naturalWidth, height: image.naturalHeight }
  }, source)
  t.diagnostic(`Exact map rendered in ${Date.now() - started} ms: ${JSON.stringify(result)}`)
  assert.equal(result.type, 'image/png')
  assert.ok(result.size > 10000)
  assert.ok(result.width > 100 && result.height > 100)
  assert.ok(result.width <= 4096 && result.height <= 4096)
  assert.equal(await page.evaluate(() => window.renderedLabels), source.split('\n').filter(line => /^\*+ /.test(line)).length)
  assert.equal(await page.locator('iframe').count(), 0)
})
