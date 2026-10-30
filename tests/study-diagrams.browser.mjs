import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

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
