import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

test('repeated menu and keyboard pastes retain unrelated image and PDF previews and table DOM', { timeout: 60000 }, async t => {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { readText: async () => '', write: async () => {} } })
    window.previewStats = { decodes: 0, releases: 0, placeholders: 0, textCount: 0 }
    const decode = window.createImageBitmap.bind(window)
    window.createImageBitmap = async (...args) => {
      window.previewStats.decodes++
      const bitmap = await decode(...args), close = bitmap.close.bind(bitmap)
      bitmap.close = () => { window.previewStats.releases++; close() }
      return bitmap
    }
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (text === 'Cargando archivo...') window.previewStats.placeholders++
      if (text === 'Texto para copiar') window.previewStats.textCount++
      return fillText.call(this, text, ...args)
    }
  })
  let version = 1
  let content = {
    camera: { x: 0, y: 0, zoom: 1 }, strokes: [], graphs: [], videos: [], shapes: [],
    texts: [{ id: 'text', x: 100, y: 400, text: 'Texto para copiar', fontSize: 24, color: '#111111' }],
    media: ['image', 'pdf-page'].map((kind, i) => ({ id: kind, assetId: kind, kind, x: 100 + i * 220, y: 200, width: 100, height: 100, name: kind })),
    tables: [{ id: 'stable-table', name: 'Tabla', x: 700, y: 200, cellWidth: 100, cellHeight: 30, cells: [[{ input: '1' }]] }],
  }
  const directory = resolve('public/pizarra')
  await page.route('https://paste.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    const api = path.replace(/^\/pizarra(?=\/)/, '')
    if (api === '/api/auth/me') return route.fulfill({ json: { id: 'paste-user', display_name: 'Prueba' } })
    if (api === '/api/library') return route.fulfill({ json: { folders: [], boards: [{ id: 'paste-board', name: 'Pegados', version, role: 'editor' }] } })
    if (api === '/api/boards/paste-board') {
      if (route.request().method() === 'PUT') { content = route.request().postDataJSON().content; version++ }
      return route.fulfill({ json: { id: 'paste-board', name: 'Pegados', version, content } })
    }
    if (api.startsWith('/api/assets/')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=', 'base64') })
    if (api.startsWith('/api/')) return route.fulfill({ status: 404, body: '{}' })
    const file = resolve(directory, '.' + (path === '/pizarra/' ? '/index.html' : path.slice('/pizarra'.length)))
    assert.ok(file.startsWith(directory + sep))
    try { return await route.fulfill({ body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream' }) }
    catch { return route.fulfill({ status: 404 }) }
  })
  await page.goto('https://paste.test/pizarra/')
  const canvas = page.locator('.app > canvas').first()
  await expect(canvas).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.previewStats.decodes)).toBeGreaterThanOrEqual(2)
  await expect(page.locator('[data-table-id="stable-table"]')).toBeVisible()
  await page.waitForTimeout(300)
  await page.evaluate(() => { window.stableTable = document.querySelector('[data-table-id="stable-table"]') })
  await page.getByRole('button', { name: 'Seleccionar área', exact: true }).click()
  await canvas.click({ button: 'right', position: { x: 150, y: 410 } })
  await page.getByRole('menuitem', { name: /^Copiar/ }).click()
  const before = await page.evaluate(() => ({ ...window.previewStats }))
  for (let i = 0; i < 4; i++) {
    await canvas.click({ button: 'right', position: { x: 600, y: 500 } })
    await page.getByRole('menuitem', { name: /^Pegar/ }).click()
    await canvas.evaluate(node => node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })))
  }
  await expect.poll(() => content.texts.length).toBe(9)
  // Copying an image reuses its asset; it must also retain the other PDF preview.
  await canvas.click({ button: 'right', position: { x: 150, y: 250 } })
  await page.getByRole('menuitem', { name: /^Copiar/ }).click()
  await canvas.click({ button: 'right', position: { x: 600, y: 500 } })
  await page.getByRole('menuitem', { name: /^Pegar/ }).click()
  await expect.poll(() => content.media.length).toBe(3)
  const after = await page.evaluate(() => ({ ...window.previewStats, sameTable: window.stableTable === document.querySelector('[data-table-id="stable-table"]') }))
  assert.equal(after.decodes, before.decodes, 'existing assets must not be decoded again')
  assert.equal(after.releases, before.releases, 'existing previews must not be discarded')
  assert.equal(after.placeholders, before.placeholders, 'pastes must not flash loading placeholders')
  assert.ok(after.textCount > before.textCount, 'pasted text was drawn')
  assert.equal(after.sameTable, true)
  assert.deepEqual(errors, [])
})
