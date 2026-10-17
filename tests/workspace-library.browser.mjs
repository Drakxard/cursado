import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

function fixturePdf() {
  const stream = 'BT /F1 20 Tf 30 100 Td (Biblioteca offline) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let text = '%PDF-1.4\n', offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(text)
}

test('mobile library navigates subjects, important notes, shared board rendering and PDF while offline', async () => {
  const assets = path.resolve(process.env.INSCREEN_LIBRARY_ASSETS || '../InScreen/modules/library')
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const rev = 'revision-browser-test-12345', id = char => char.repeat(64)
    const scene = { strokes: [{ points: [{ x: 30, y: 80 }, { x: 280, y: 110 }], width: 5, color: '#2563eb' }], texts: [{ id: 'text', x: 30, y: 20, text: 'Pizarra de prueba', fontSize: 22, color: '#111827' }], media: [], shapes: [{ id: 'shape', x: 20, y: 140, width: 270, height: 110, kind: 'rectangle', color: '#111827', strokeWidth: 2, visualType: 'sticky', note: { text: 'Nota compartida', fontSize: 18, background: '#fff0a6' } }], tables: [{ id: 'table', x: 20, y: 280, name: 'Tabla', cellWidth: 114, cellHeight: 33, cells: [[{ input: '2' }, { input: '=A1+3' }]] }], graphs: [] }
    const files = [{ id: id('a'), path: 'boards/test.json', hash: id('b'), mime: 'application/vnd.cursado.board+json', size: 1 }, { id: id('c'), path: 'teoria/ejemplo.pdf', hash: id('d'), mime: 'application/pdf', size: 1 }]
    const inventory = { version: 1, workspaceId: 'workspace-browser-12345', revision: rev, name: 'Biblioteca', publishedAt: new Date().toISOString(), files, subjects: [{ id: 'calculo', name: 'Cálculo', color: '#2563eb' }], items: [{ id: 'board', title: 'Pizarra de prueba', kind: 'board', fileId: id('a') }, { id: 'pdf', title: 'PDF de prueba', kind: 'pdf', fileId: id('c'), subjectId: 'calculo', week: 1, section: 'Teoría' }, { id: 'note', title: 'Apunte importante', kind: 'text', subjectId: 'calculo', week: 1, section: 'Apuntes', text: 'Conservado sin conexión', important: true }] }
    const resources = new Map([[id('a'), Buffer.from(JSON.stringify({ scene, assets: {} }))], [id('c'), fixturePdf()]])
    const mimes = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/files/')) { const resource = resources.get(url.pathname.split('/').at(-1)); await route.fulfill({ status: resource ? 200 : 404, body: resource || '', contentType: url.pathname.endsWith(id('c')) ? 'application/pdf' : 'application/json' }); return }
      const relative = url.pathname.replace('/assets/library/', '').replace('/assets/katex/', '../../web/katex/')
      try { const file = path.resolve(assets, relative); await route.fulfill({ body: await readFile(file), contentType: mimes[path.extname(file)] || 'application/octet-stream' }) }
      catch { await route.fulfill({ status: 404, body: 'missing fixture' }) }
    })
    await page.addInitScript(({ inventory, files }) => {
      window.__snapshot = { linked: true, name: 'Biblioteca', online: false, wifi: false, manifest: inventory, available: Object.fromEntries(files.map(f => [f.id, true])) }
      window.Library = { snapshot: () => JSON.stringify(window.__snapshot), refresh() {}, pair() { window.__paired = true }, home() { window.__home = true }, unlink() {}, openHtml() {}, download() {} }
    }, { inventory, files })
    await page.goto('https://workspace.inscreen.local/assets/library/index.html')
    await page.getByRole('button', { name: 'Estudio' }).click()
    await page.getByRole('button', { name: /Importantes/ }).click()
    await page.getByRole('button', { name: /Apunte importante/ }).click()
    await page.getByText('Conservado sin conexión', { exact: true }).waitFor()
    await page.evaluate(() => { history = []; view = { kind: 'home' }; render() })
    await page.getByRole('button', { name: 'Pizarra' }).click()
    await page.getByRole('button', { name: /Pizarra de prueba/ }).click()
    await page.getByText('Tabla', { exact: true }).waitFor()
    await page.getByText('5', { exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.board-host canvas')].some(canvas => { const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return pixels.some((value, index) => index % 4 === 3 && value > 0) }))
    await page.getByRole('button', { name: 'Ajustar vista' }).click()
    await mkdir('.cache', { recursive: true }); await page.screenshot({ path: '.cache/library-board-mobile.png' })
    await page.evaluate(() => { history = []; view = { kind: 'home' }; render() })
    await page.getByRole('button', { name: 'Estudio' }).click()
    await page.getByRole('button', { name: /Cálculo/ }).click()
    await page.getByRole('button', { name: /Semana 1/ }).click()
    await page.getByRole('button', { name: /^Teoría/ }).click()
    await context.setOffline(true)
    await page.getByRole('button', { name: /PDF de prueba/ }).click()
    await page.frameLocator('.pdf-viewer').locator('.page[data-page-number="1"] canvas').waitFor({ timeout: 20000 })
    assert.equal(await page.frameLocator('.pdf-viewer').locator('#toolbarContainer').isVisible(), true)
    assert.equal(await page.frameLocator('.pdf-viewer').locator('#editorModeButtons').isVisible(), false)
    await page.screenshot({ path: '.cache/library-pdf-mobile.png' })
    assert.deepEqual(errors, [])
    await context.close()
  } finally { await browser.close() }
})
