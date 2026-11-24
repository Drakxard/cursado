import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createServer } from '../pizarra-sync/packages/client-web/node_modules/vite/dist/node/index.js'

test('zoom scales study dots and the context menu downloads only selected objects', { timeout: 90000 }, async t => {
  const server = await createServer({ root: resolve('pizarra-sync/packages/client-web'), server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  t.after(() => server.close())
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  await page.addInitScript(() => {
    localStorage.setItem('komuboard-identity-nudged', '1')
    localStorage.setItem('komuboard-locale', 'es')
    window.__komuboardAutoFit = false
  })
  await page.route('**/rooms/resolve?**', route => route.fulfill({ json: { roomId: 'export-test' } }))
  await page.routeWebSocket('**', socket => socket.close())
  await page.goto(server.resolvedUrls.local[0] + '?room=export-test')
  await page.waitForFunction(() => window.__komuboard?.canvas)
  await page.evaluate(() => {
    const { doc, canvas } = window.__komuboard
    const objects = doc.getMap('objects'), order = doc.getArray('order')
    doc.transact(() => {
      // Overlapping objects ensure cropping alone cannot satisfy selection-only export.
      for (const [id, x, text, bg] of [['chosen', 200, 'CONTENIDO ELEGIDO', '#ff0000'], ['other', 230, 'NO EXPORTAR', '#00ff00']]) {
        const object = new objects.constructor()
        for (const [key, value] of Object.entries({ id, type: 'text', x, y: 200, width: 220, height: 120, bg, runs: [{ text }], fontFamily: 'sans-serif', fontSize: 18, align: 'left', authorId: 'test' })) object.set(key, value)
        objects.set(id, object)
        order.push([id])
      }
    })
    canvas.selectById('chosen')
    document.getElementById('board').dataset.studyGrid = 'true'
  })
  const gridRuns = await page.evaluate(async () => {
    const canvas = window.__komuboard.canvas
    const runs = []
    for (const scale of [1, 5]) {
      canvas.viewport.applyTransform(scale, { x: 0, y: 0 })
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const grid = document.querySelector('.canvas-grid'), ratio = devicePixelRatio
      const pixels = grid.getContext('2d').getImageData(0, 0, grid.width, 1).data
      const dots = []
      let previous = false
      for (let x = 0; x < grid.width; x++) {
        const filled = pixels[x * 4 + 3] > 15
        if (filled && !previous) dots.push({ start: x / ratio, width: 0 })
        if (filled) dots.at(-1).width += 1 / ratio
        previous = filled
      }
      runs.push(dots)
    }
    canvas.viewport.applyTransform(1, { x: 0, y: 0 })
    return runs
  })
  assert.ok(gridRuns[1][1].width >= 7, 'maximum zoom has large dots')
  assert.ok(Math.abs(gridRuns[1][2].start - gridRuns[1][1].start - 64) < 1, 'maximum zoom spaces dots 64px apart')
  assert.ok(gridRuns[0].length > gridRuns[1].length * 3, 'zooming out makes the grid denser')
  const openMenu = async () => {
    // Click within the selection but outside the overlapping unselected object.
    await page.locator('#board').click({ button: 'right', position: { x: 210, y: 220 } })
    await expect(page.getByRole('menuitem', { name: 'Exportar SVG', exact: true })).toBeVisible()
  }
  await openMenu()
  const svgEvent = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Exportar SVG', exact: true }).click()
  const svgDownload = await svgEvent, svg = await readFile(await svgDownload.path(), 'utf8')
  assert.match(svgDownload.suggestedFilename(), /seleccion-.*\.svg$/)
  assert.ok(svg.includes('CONTENIDO ELEGIDO'))
  assert.ok(!svg.includes('NO EXPORTAR'))
  assert.ok(!svg.includes('komu-text-resize'))
  const svgGeometry = await page.evaluate(source => {
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
    return { name: svg.localName, width: Number(svg.getAttribute('width')), height: Number(svg.getAttribute('height')) }
  }, svg)
  assert.equal(svgGeometry.name, 'svg')
  assert.ok(svgGeometry.width > 220 && svgGeometry.width < 350)
  assert.ok(svgGeometry.height > 120 && svgGeometry.height < 250)
  const colors = await page.evaluate(async source => {
    const image = new Image()
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source)
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let red = 0, green = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 220 && pixels[i + 1] < 30 && pixels[i + 3] > 200) red++
      if (pixels[i + 1] > 220 && pixels[i] < 30 && pixels[i + 3] > 200) green++
    }
    return { red, green }
  }, svg)
  assert.ok(colors.red > 1000, 'the downloaded SVG renders the chosen object')
  assert.equal(colors.green, 0, 'overlapping unselected content is absent from the rendered SVG')
  await expect(page.locator('.export-scrim')).toHaveCount(0)
  assert.equal(await page.evaluate(() => window.__komuboard.canvas.getZoomPercent()), 100)
  await openMenu()
  const pdfEvent = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Exportar PDF', exact: true }).click()
  const pdfDownload = await pdfEvent, pdf = await readFile(await pdfDownload.path())
  assert.match(pdfDownload.suggestedFilename(), /seleccion-.*\.pdf$/)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  await expect(page.locator('.export-scrim')).toHaveCount(0)
  assert.deepEqual(await page.evaluate(() => window.__komuboard.canvas.selectionIds()), ['chosen'])
  await expect(page.locator('.komu-text[data-id="chosen"]')).toHaveClass(/selected/)
})
