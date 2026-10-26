// Actual file import, not pre-seeded blobs. Run against a Vite production preview.
import { chromium, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { instrumentResources, resourceSampler } from './browser-resource-metrics.mjs'

const origin = process.env.BOARD_TEST_URL || 'http://127.0.0.1:4173'
const reports = []
for (const count of (process.env.IMAGE_COUNTS || '10,30,100').split(',').map(Number)) {
  const persistent = process.env.MEASURE_FRESH_BROWSER === '1'
  mkdirSync('.cache/image-performance', { recursive: true })
  const profile = persistent ? mkdtempSync(path.resolve('.cache/image-performance/profile-')) : undefined
  const options = { channel: 'chrome', args: ['--enable-precise-memory-info'] }
  let context = persistent ? await chromium.launchPersistentContext(profile, { ...options, viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' }) : undefined
  let browser = context?.browser() ?? await chromium.launch(options)
  try {
    let page = context?.pages()[0] ?? await browser.newPage({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
    await page.addInitScript(instrumentResources)
    await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'offline' }))
    await page.route(origin + '/__resource-setup', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
    const settleImages = async () => {
      let previous = -1, stable = 0
      for (let i = 0; i < 120 && stable < 3; i++) {
        await page.waitForTimeout(500)
        const current = await page.evaluate(() => window.resourceStats.decodes)
        stable = current === previous ? stable + 1 : 0; previous = current
      }
      if (stable < 3) throw new Error('Image decoding did not settle')
    }
    await page.goto(origin + '/pizarra/')
    await page.getByRole('button', { name: 'Abrir privadas y copias de este dispositivo' }).click()
    await expect(page.locator('.app')).toBeVisible()
    const fixtures = await page.evaluate(() => {
      return ['text', 'gradient', 'alpha'].map(kind => {
        const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400
        const ctx = canvas.getContext('2d')
        if (kind !== 'alpha') {
          const gradient = ctx.createLinearGradient(0, 0, 3200, 2400); gradient.addColorStop(0, '#eef'); gradient.addColorStop(.5, '#2a5'); gradient.addColorStop(1, '#e76')
          ctx.fillStyle = kind === 'text' ? '#fff' : gradient; ctx.fillRect(0, 0, 3200, 2400)
        }
        ctx.fillStyle = '#123'; ctx.font = '72px sans-serif'
        for (let line = 0; line < 24; line++) ctx.fillText(`Texto legible ${line}: ecuaciones, apuntes y detalles`, 80, 120 + line * 90)
        if (kind === 'gradient') for (let i = 0; i < 1000; i++) { ctx.fillStyle = `hsl(${i * 17 % 360} 60% 40% / .3)`; ctx.fillRect(i * 71 % 3200, i * 113 % 2400, 30, 30) }
        const base64 = canvas.toDataURL('image/png').split(',')[1]; canvas.width = canvas.height = 0
        return base64
      })
    })
    const sample = await resourceSampler(browser, page)
    const originalSizes = fixtures.map(base64 => Buffer.from(base64, 'base64').length)
    await page.evaluate(sizes => { window.resourceStats.originalSizes = sizes }, originalSizes)
    await page.addInitScript(sizes => { window.resourceStats.originalSizes = sizes }, originalSizes)
    const directory = path.resolve('.cache/image-performance', `import-${count}`)
    mkdirSync(directory, { recursive: true })
    const files = Array.from({ length: count }, (_, i) => {
      const file = path.join(directory, `image-${i}.png`)
      writeFileSync(file, Buffer.from(fixtures[i % 3], 'base64')); return file
    })
    const started = Date.now()
    await page.locator('input[type=file][accept*="image/svg+xml"]').setInputFiles(files, { timeout: 180000 })
    await page.waitForFunction(async count => {
      const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
      const rows = await new Promise(resolve => { const r = db.transaction('boards').objectStore('boards').getAll(); r.onsuccess = () => resolve(r.result) })
      db.close(); return rows.some(row => row.content.media.length === count)
    }, count, { timeout: 180000 })
    await settleImages()
    const importMs = Date.now() - started, results = [await sample('after actual import, images overlapping')]
    // Arrange the imported scene so all images are visible, preserving original references.
    // Leave first: pagehide flushes the live scene and must not overwrite the fixture edit.
    await page.goto(origin + '/__resource-setup'); await page.waitForTimeout(300)
    await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
      await new Promise(resolve => {
        const tx = db.transaction('boards', 'readwrite'), store = tx.objectStore('boards'), r = store.get(localStorage.getItem('pizarra_activa'))
        r.onsuccess = () => { const row = r.result; row.content.camera = { x: 0, y: 0, zoom: 1 }; row.content.media.forEach((item, i) => Object.assign(item, { x: 60 + i % 10 * 120, y: 170 + Math.floor(i / 10) * 65, width: 100, height: 75 })); store.put(row) }
        tx.oncomplete = resolve
      }); db.close()
    })
    await page.goto(origin + '/pizarra/'); await expect(page.locator('.app')).toBeVisible(); await settleImages()
    results.push(await sample('grid after reopen'))
    await page.evaluate(() => window.startFrameSample())
    await page.mouse.move(650, 450)
    for (let step = 0; step < 30; step++) {
      await page.keyboard.down('Control'); await page.mouse.wheel(0, step < 15 ? -20 : 20); await page.keyboard.up('Control')
      await page.waitForTimeout(20)
    }
    await page.waitForTimeout(400); await page.evaluate(() => { window.resourceStats.sampling = false }); await settleImages()
    results.push(await sample('zoom burst settled'))
    for (let cycle = 0; cycle < 20; cycle++) {
      await page.mouse.wheel(0, 2500); await page.waitForTimeout(200)
      await page.mouse.wheel(0, -2500); await page.waitForTimeout(200)
      if (cycle === 9 || cycle === 19) { await settleImages(); results.push(await sample(`after ${cycle + 1} camera cycles`)) }
    }
    const disk = await page.evaluate(async () => {
      if (!(await indexedDB.databases()).some(db => db.name === 'pizarra-image-previews-v1')) return null
      const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-image-previews-v1'); r.onsuccess = () => resolve(r.result) })
      const rows = await new Promise(resolve => { const r = db.transaction('metadata').objectStore('metadata').getAll(); r.onsuccess = () => resolve(r.result) })
      db.close(); return { entries: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0) }
    })
    if (persistent) {
      await browser.close()
      context = await chromium.launchPersistentContext(profile, { ...options, viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
      browser = context.browser(); page = context.pages()[0]
      await page.addInitScript(instrumentResources)
      await page.addInitScript(sizes => { window.resourceStats.originalSizes = sizes }, originalSizes)
      await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'offline' }))
      await page.goto(origin + '/pizarra/'); await expect(page.locator('.app')).toBeVisible(); await settleImages()
      const warmSample = await resourceSampler(browser, page)
      results.push(await warmSample('fresh browser with cached board'))
    }
    if (disk) {
      assert.ok(disk.bytes <= 256 * 1024 * 1024, 'Encoded cache exceeded its budget')
      assert.ok(results.every(result => result.decodedBytes <= 64 * 1024 * 1024), 'Settled decoded pixels exceeded their budget')
      assert.ok(results.slice(1).every(result => result.originalDecodes === 0), 'Overview/zoom unexpectedly decoded full originals')
      assert.ok(results[4].jsHeapBytes - results[3].jsHeapBytes < 8 * 1024 * 1024, 'Heap grew after repeated camera cycles')
    }
    reports.push({ count, importMs, disk, results })
    console.log(JSON.stringify(reports.at(-1)))
  } finally { await browser.close() }
}
const report = { fixture: 'real imports of 3200x2400 PNGs: text, gradients with detail, transparency; 1366x900 DPR1', note: 'Synthetic fixtures, not personal files or real photos. Working set includes browser and GPU; decoded peaks include transient bitmaps, not all decoder buffers.', reports }
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2))
