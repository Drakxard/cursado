import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

test('night colours update without scanning board contents during camera frames', async t => {
  const bundle = await build({ entryPoints: ['pizarra-sync/packages/client-web/src/night-readability.ts'], bundle: true, format: 'iife', globalName: 'night', write: false })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<html data-theme="dark"><body><div id="board"><div class="canvas-grid"></div><div class="text-layer"><div class="komu-text" style="color:#111111"><span style="color:#222222">Texto</span></div></div></div></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const result = await page.evaluate(async () => {
    night.installNightReadability()
    const text = document.querySelector('.komu-text'), span = text.firstElementChild
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await frame()
    const initial = text.style.color
    let scans = 0
    const original = Element.prototype.querySelectorAll
    Element.prototype.querySelectorAll = function (...args) { scans++; return original.apply(this, args) }
    for (let i = 0; i < 12; i++) {
      document.querySelector('.text-layer').style.transform = `scale(${1 + i / 100})`
      document.querySelector('.canvas-grid').style.setProperty('--grid-fine', `${i}px`)
      await frame()
    }
    const cameraScans = scans
    Element.prototype.querySelectorAll = original
    span.style.color = '#000000'
    await frame()
    const edited = span.style.color
    document.documentElement.dataset.theme = 'light'
    await frame()
    return { initial, cameraScans, edited, restored: text.style.color, restoredEdit: span.style.color }
  })
  assert.equal(result.cameraScans, 0)
  assert.notEqual(result.initial, 'rgb(17, 17, 17)')
  assert.notEqual(result.edited, 'rgb(0, 0, 0)')
  assert.equal(result.restored, 'rgb(17, 17, 17)')
  assert.equal(result.restoredEdit, 'rgb(0, 0, 0)')
})
