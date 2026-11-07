import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

for (const deviceScaleFactor of [1, 2]) test(`image reader keeps original detail during gestures, scrolls vertically, zooms with Ctrl and releases input on close (DPR ${deviceScaleFactor})`, { timeout: 90000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import {createRoot} from 'react-dom/client';
    import {StudyImageViewer} from './components/study-image-viewer';
    const root=createRoot(document.getElementById('root'));
    const images=[{id:'diagram',url:'http://reader.test/diagram.svg',document:true},{id:'photo',url:'http://reader.test/photo.svg'}];
    window.showReader=(theme='dark',nightImages='auto')=>root.render(<StudyImageViewer images={images} initialId="diagram" theme={theme} nightImages={nightImages} onClose={()=>root.render(null)}/>);
    window.showReader();
  ` }, bundle: true, format: 'esm', write: false, jsx: 'automatic' })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor })
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
  await mkdir('test-results/image-reader', { recursive: true })
  await page.screenshot({ path: `test-results/image-reader/night-${deviceScaleFactor}.png` })
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
  // Input bursts are coalesced into one original-resolution crop per frame.
  const report = await host.evaluate(async el => {
    const canvas = el.querySelector('[data-study-image-preview]')
    const matrix = () => JSON.parse(el.querySelector('[data-study-image-detail]').dataset.camera)
    const before = matrix(), anchor = { x: 680, y: 380 }, world = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale }
    const frames = [], handlers = []; let previous = performance.now()
    for (let i = 0; i < 40; i++) {
      const start = performance.now()
      for (let j = 0; j < 8; j++) el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: i % 2 ? 1 : -1, ctrlKey: true, clientX: anchor.x, clientY: anchor.y }))
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
  assert.ok(report.detailDraws >= 39 && report.detailDraws <= 40, `expected one original crop per frame, got ${report.detailDraws}`)
  assert.ok(report.anchorError < .01)
  assert.ok(Math.max(report.texture.width, report.texture.height) <= 2048)
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  assert.ok(await page.evaluate(() => window.detailDraws) > 0)
  assert.ok(await detail.evaluate(el => el.width <= innerWidth * 2 && el.height <= innerHeight * 2))
  const transform = async () => detail.evaluate(el => JSON.parse(el.dataset.camera))
  // Browser zoom shortcuts must change the image camera and prevent the default.
  const fit = await transform()
  const shortcut = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event); return event.defaultPrevented
  })
  assert.equal(shortcut, true)
  await expect.poll(async () => (await transform()).scale).toBeCloseTo(fit.scale * 1.5, 6)
  await page.keyboard.press('Control+-')
  await expect.poll(async () => (await transform()).scale).toBeCloseTo(fit.scale, 6)
  await page.keyboard.press('Control+=')
  await expect.poll(async () => (await transform()).scale).toBeCloseTo(fit.scale * 1.5, 6)
  const beforeScroll = await transform()
  await page.mouse.move(680, 380); await page.mouse.wheel(0, 60 * deviceScaleFactor)
  await expect.poll(async () => (await transform()).y).toBeCloseTo(beforeScroll.y - 60, 4)
  const afterScroll = await transform()
  assert.equal(afterScroll.x, beforeScroll.x)
  assert.equal(afterScroll.scale, beforeScroll.scale)
  await page.mouse.down()
  const start = await transform()
  await page.mouse.move(681, 381)
  await expect.poll(async () => (await transform()).x - start.x).toBeCloseTo(1, 2)
  await page.waitForTimeout(250)
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await page.mouse.move(679, 379)
  await expect.poll(async () => (await transform()).x - start.x).toBeCloseTo(-1, 2)
  // Pixels while dragging must match the settled view at the same position.
  await expect(preview).toHaveCSS('visibility', 'hidden')
  const movingPixels = await detail.evaluate(el => el.toDataURL())
  await page.mouse.up(); await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await page.waitForTimeout(250)
  assert.equal(await detail.evaluate(el => el.toDataURL()), movingPixels)
  // Compare the displayed crop with an independent draw from the original image.
  assert.equal(await detail.evaluate(async el => {
    const original = new Image(); original.src = 'http://reader.test/diagram.svg'; await original.decode()
    const reference = document.createElement('canvas'); reference.width = el.width; reference.height = el.height
    const ctx = reference.getContext('2d'), {x,y,scale} = JSON.parse(el.dataset.camera), ratio = devicePixelRatio
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    const sx = Math.max(0, -x / scale), sy = Math.max(0, -y / scale)
    const ex = Math.min(original.naturalWidth, (innerWidth - x) / scale), ey = Math.min(original.naturalHeight, (innerHeight - y) / scale)
    ctx.drawImage(original, sx, sy, ex-sx, ey-sy, (x+sx*scale)*ratio, (y+sy*scale)*ratio, (ex-sx)*scale*ratio, (ey-sy)*scale*ratio)
    return reference.toDataURL() === el.toDataURL()
  }), true)

  // Pinch, cancellation, resize, and close must not leave a gesture or listener active.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 600, y: 380, id: 1 }, { x: 760, y: 380, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 580, y: 380, id: 1 }, { x: 780, y: 380, id: 2 }] })
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await page.keyboard.press('ArrowRight')
  await expect(host).toHaveAttribute('data-render-mode', 'detail')
  await expect(detail).toHaveCSS('filter', 'none')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => detail.evaluate(el => el.width)).toBe(390 * deviceScaleFactor)
  await page.evaluate(() => window.restoreDraw())
  await page.keyboard.press('Escape'); await expect(reader).toHaveCount(0)
  assert.equal(await page.evaluate(() => { const e = new WheelEvent('wheel', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }), false)
  assert.deepEqual(errors, [])
  await writeFile(`test-results/image-reader/navigation-${deviceScaleFactor}.json`, JSON.stringify(report, null, 2))
  console.log('Full-screen image gestures:', report)
})
