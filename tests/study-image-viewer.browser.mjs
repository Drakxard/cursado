import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

test('image reader composites gestures, applies night mode and releases camera input on close', { timeout: 90000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import {StudyImageViewer} from './components/study-image-viewer';
    const root=createRoot(document.getElementById('root'));
    const images=[{id:'diagram',url:'http://reader.test/diagram.svg',document:true},{id:'photo',url:'http://reader.test/photo.svg'}];
    window.showReader=(theme='dark',nightImages='auto')=>root.render(<StudyImageViewer images={images} initialId="diagram" theme={theme} nightImages={nightImages} onClose={()=>root.render(null)}/>);
    window.showReader();
  ` }, bundle: true, format: 'esm', write: false, jsx: 'automatic' })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  let requests = 0
  await page.route('http://reader.test/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/fixture.js"></script>' })
    if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    requests++
    return route.fulfill({ contentType: 'image/svg+xml', body: path === '/diagram.svg'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="16000"><rect width="8000" height="16000" fill="white"/><path d="M1000 8000H7000M4000 1000V15000" stroke="black" stroke-width="30"/><text x="500" y="500" font-size="120">Diagrama</text></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#f08030"/><circle cx="800" cy="600" r="450" fill="#2080d0"/></svg>' })
  })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://reader.test/')
  const reader = page.getByRole('dialog'), host = reader.locator('[data-study-image-viewer]')
  const preview = reader.locator('[data-study-image-preview]'), detail = reader.locator('[data-study-image-detail]')
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await expect(reader).toHaveCSS('background-color', 'rgb(16, 20, 27)')
  await expect(detail).toHaveCSS('filter', 'invert(0.9) hue-rotate(180deg)')
  await expect(preview).toHaveCSS('filter', 'invert(0.9) hue-rotate(180deg)')
  await page.evaluate(() => window.showReader('dark', 'original'))
  await expect(detail).toHaveCSS('filter', 'none')
  await page.evaluate(() => window.showReader('light', 'auto'))
  await expect(reader).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(detail).toHaveCSS('filter', 'none')
  await page.evaluate(() => window.showReader('dark', 'auto'))
  assert.equal(requests, 1, 'theme and filter changes must not fetch/decode the image again')

  await page.evaluate(() => {
    window.detailDraws = 0; window.inputTimes = []; window.cameraFrames = []
    const draw = CanvasRenderingContext2D.prototype.drawImage
    window.restoreDraw = () => { CanvasRenderingContext2D.prototype.drawImage = draw }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.hasAttribute('data-study-image-detail')) window.detailDraws++
      return Reflect.apply(draw, this, args)
    }
  })
  // Bursts are coalesced; input latency is measured separately from drawing at rest.
  const report = await host.evaluate(async el => {
    const canvas = el.querySelector('[data-study-image-preview]')
    const matrix = () => { const m = new DOMMatrix(canvas.style.transform); return { x: m.m41, y: m.m42, scale: m.m11 } }
    const before = matrix(), anchor = { x: 680, y: 380 }, world = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale }
    const frames = [], handlers = []; let previous = performance.now()
    for (let i = 0; i < 40; i++) {
      const start = performance.now()
      for (let j = 0; j < 8; j++) el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: i % 2 ? 1 : -1, clientX: anchor.x, clientY: anchor.y }))
      handlers.push(performance.now() - start)
      await new Promise(resolve => requestAnimationFrame(resolve))
      const now = performance.now(); frames.push(now - previous); previous = now
    }
    const after = matrix()
    const sorted = [...frames].sort((a, b) => a - b)
    return { detailDraws: window.detailDraws, anchorError: Math.hypot(after.x + world.x * after.scale - anchor.x, after.y + world.y * after.scale - anchor.y),
      frameP50: sorted[20], frameP95: sorted[38], maxFrame: sorted[39], maxHandlerBurst: Math.max(...handlers),
      texture: { width: canvas.width, height: canvas.height } }
  })
  assert.equal(report.detailDraws, 0)
  assert.ok(report.anchorError < .01)
  assert.ok(Math.max(report.texture.width, report.texture.height) <= 2048)
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  assert.ok(await page.evaluate(() => window.detailDraws) > 0)
  assert.ok(await detail.evaluate(el => el.width <= innerWidth * 2 && el.height <= innerHeight * 2))
  await page.mouse.move(680, 380); await page.mouse.wheel(0, -60)
  await expect(host).toHaveAttribute('data-render-mode', 'preview')
  await page.mouse.down()
  const transform = async () => preview.evaluate(el => { const m = new DOMMatrix(el.style.transform); return { x: m.m41, y: m.m42 } })
  const start = await transform()
  await page.mouse.move(681, 381)
  await expect.poll(async () => (await transform()).x - start.x).toBeCloseTo(1, 2)
  await page.waitForTimeout(250)
  await expect(host).toHaveAttribute('data-render-mode', 'preview')
  await page.mouse.move(679, 379)
  await expect.poll(async () => (await transform()).x - start.x).toBeCloseTo(-1, 2)
  await page.mouse.up(); await expect(host).toHaveAttribute('data-render-mode', 'detail')

  // Pinch, cancellation, resize, and close must not leave a gesture or listener active.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 600, y: 380, id: 1 }, { x: 760, y: 380, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 580, y: 380, id: 1 }, { x: 780, y: 380, id: 2 }] })
  await expect(host).toHaveAttribute('data-render-mode', 'preview')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await page.keyboard.press('ArrowRight')
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await expect(detail).toHaveCSS('filter', 'none')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => detail.evaluate(el => el.width)).toBe(390)
  await page.evaluate(() => window.restoreDraw())
  await page.keyboard.press('Escape'); await expect(reader).toHaveCount(0)
  assert.equal(await page.evaluate(() => { const e = new WheelEvent('wheel', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }), false)
  assert.deepEqual(errors, [])
  await mkdir('test-results/image-reader', { recursive: true })
  await writeFile('test-results/image-reader/navigation.json', JSON.stringify(report, null, 2))
  console.log('Full-screen image gestures:', report)
})
