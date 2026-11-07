import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

for (const deviceScaleFactor of [1, 2]) test(`camera grid stays aligned, changes theme and switches to lines (DPR ${deviceScaleFactor})`, async t => {
  const bundle = await build({ entryPoints: ['pizarra-sync/packages/client-web/src/viewport-grid.ts'], bundle: true, format: 'iife', globalName: 'gridModule', write: false })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage({ deviceScaleFactor })
  await page.setContent('<style>.canvas-grid{color:rgb(40,60,80)}html[data-theme="dark"] .canvas-grid{color:rgb(180,200,220)}</style><div id="board"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const result = await page.evaluate(async () => {
    const host = document.querySelector('#board'), grid = new gridModule.ViewportGrid(host), canvas = grid.element
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const pixel = (x, y) => [...canvas.getContext('2d').getImageData(Math.floor(x * devicePixelRatio), Math.floor(y * devicePixelRatio), 1, 1).data]
    // These offsets include negative coordinates, fractional pan and octave boundaries.
    const samples = []
    for (const scale of [.25, .5, .99, 1, 1.01, 2, 4]) {
      const x = -143.25, y = 77.5, spacing = 48 * scale * 2 ** Math.floor(Math.log2(1 / scale))
      grid.draw({ x, y, scale, width: 320, height: 200 })
      const px = ((x % spacing) + spacing) % spacing + spacing, py = ((y % spacing) + spacing) % spacing + spacing
      samples.push({ dot: pixel(px, py)[3], gap: pixel(px + spacing / 4, py)[3] })
    }
    grid.draw({ x: 48, y: 48, scale: 1, width: 320, height: 200 })
    const light = pixel(48, 48), dotGap = pixel(60, 48)[3]
    document.documentElement.dataset.theme = 'dark'; await frame()
    const dark = pixel(48, 48)
    host.dataset.grid = 'lines'; await frame()
    const line = pixel(60, 48)[3], lineGap = pixel(60, 60)[3]
    grid.draw({ x: 48, y: 48, scale: 1, width: 200, height: 320 })
    const size = [canvas.width, canvas.height], visible = pixel(48, 48)[3]
    grid.destroy()
    return { samples, light, dark, dotGap, line, lineGap, size, visible, removed: !canvas.isConnected, released: canvas.width === 0 && canvas.height === 0 }
  })
  for (const sample of result.samples) { assert.ok(sample.dot > 0); assert.equal(sample.gap, 0) }
  assert.deepEqual(result.light.slice(0, 3), [40, 60, 80])
  assert.deepEqual(result.dark.slice(0, 3), [180, 200, 220])
  assert.equal(result.dotGap, 0); assert.ok(result.line > 0); assert.equal(result.lineGap, 0)
  assert.deepEqual(result.size, [200 * deviceScaleFactor, 320 * deviceScaleFactor])
  assert.ok(result.visible > 0); assert.ok(result.removed && result.released)
})
