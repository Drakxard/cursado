import { test, expect } from '@playwright/test'

async function openLocal(page) {
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'offline' }))
  await page.goto('/pizarra/')
  await page.getByRole('button', { name: 'Abrir privadas y copias de este dispositivo' }).click()
  await expect(page.locator('.app')).toBeVisible()
}

test('previews follow zoom, release deleted images and leave stored originals intact', async ({ page }) => {
  await page.addInitScript(() => {
    window.previewMemory = { bytes: 0, peak: 0, widths: [] }
    const decode = window.createImageBitmap.bind(window)
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args)
      if (!args[1]?.resizeWidth) return bitmap
      const bytes = bitmap.width * bitmap.height * 4
      const stats = window.previewMemory
      stats.widths.push(bitmap.width); stats.bytes += bytes; stats.peak = Math.max(stats.peak, stats.bytes)
      const close = bitmap.close.bind(bitmap)
      let closed = false
      bitmap.close = () => { if (!closed) { closed = true; stats.bytes -= bytes }; close() }
      return bitmap
    }
  })
  await openLocal(page)
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 3000
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e21'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const png = canvas.toDataURL().split(',')[1]; canvas.width = canvas.height = 0; return png
  })
  await page.locator('input[type=file][accept*="image/svg+xml"]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect.poll(() => page.evaluate(() => window.previewMemory.bytes)).toBeGreaterThan(0)
  const first = await page.evaluate(() => window.previewMemory.widths.at(-1))
  expect(first).toBeLessThan(1000)
  await page.locator('.zoom-controls').getByRole('button', { name: 'Acercar', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.previewMemory.widths.at(-1))).toBeGreaterThan(first)
  const originalWidth = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
    const blobs = await new Promise(resolve => { const r = db.transaction('assets').objectStore('assets').getAll(); r.onsuccess = () => resolve(r.result) })
    db.close(); const image = await createImageBitmap(blobs[0]); const width = image.width; image.close(); return width
  })
  expect(originalWidth).toBe(4000)
  for (let cycle = 0; cycle < 10; cycle++) {
    await page.mouse.move(600, 450); await page.mouse.wheel(0, 2500)
    await expect.poll(() => page.evaluate(() => window.previewMemory.bytes)).toBe(0)
    await page.mouse.wheel(0, -2500)
    await expect.poll(() => page.evaluate(() => window.previewMemory.bytes)).toBeGreaterThan(0)
  }
  // The newly imported image remains selected while the camera zooms.
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(() => window.previewMemory.bytes)).toBe(0)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.previewMemory.bytes)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.previewMemory.peak)).toBeLessThanOrEqual(64 * 1024 * 1024)
})

function pdfFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\nendstream']
  let text = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = text.length
  return Buffer.from(text + `xref\n0 5\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
}

test('PDF import releases its worker after success and after an invalid document', async ({ page, browser }) => {
  await openLocal(page)
  const cdp = await browser.newBrowserCDPSession()
  const workers = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(target => target.type === 'worker' && target.url.includes('pdf.worker')).length
  const input = page.locator('input[type=file][accept*="image/svg+xml"]')
  await input.setInputFiles({ name: 'page.pdf', mimeType: 'application/pdf', buffer: pdfFixture() })
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('boards').objectStore('boards').getAll(); r.onsuccess = () => resolve(r.result) })
    db.close(); return rows.some(row => row.content.media.some(item => item.kind === 'pdf-page'))
  })).toBe(true)
  await expect.poll(workers).toBe(0)
  const failure = page.waitForEvent('dialog')
  await input.setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid document') })
  await (await failure).dismiss()
  await expect.poll(workers).toBe(0)
  await cdp.detach()
})
