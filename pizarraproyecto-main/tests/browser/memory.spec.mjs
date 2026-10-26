import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openLocal(page) {
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: 'offline' }))
  await page.goto('/pizarra/')
  await page.getByRole('button', { name: 'Abrir privadas y copias de este dispositivo' }).click()
  await expect(page.locator('.app')).toBeVisible()
}

test('500 shortcuts and twenty text/connector edits keep readers unloaded and canvas memory constant', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  let pdfRequests=0
  page.on('request',request=>{if(/\.pdf(?:[?#]|$)|pdf\.worker/.test(request.url()))pdfRequests++})
  await openLocal(page)
  await page.evaluate(async()=>{
    const id=localStorage.getItem('pizarra_activa')
    const db=await new Promise(resolve=>{const r=indexedDB.open('pizarra-dispositivo',1);r.onsuccess=()=>resolve(r.result)})
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('boards','readwrite'),store=tx.objectStore('boards'),request=store.get(id)
      request.onsuccess=()=>{
        const board=request.result
        board.content.shapes=Array.from({length:500},(_,i)=>({id:`shortcut-${i}`,kind:'rounded',visualType:i%2?'pdf-shortcut':'board-shortcut',
          label:`Acceso ${i}`,x:20+i%5*100,y:180+Math.floor(i/5)*70,width:90,height:54,color:'#2563eb',strokeWidth:1.5,
          ...(i%2?{pdfReference:{materialId:i+1,subjectId:'test',fileName:`document-${i}.pdf`,workspaceFileId:null}}:{boardReference:{boardId:`local:target-${i}`,name:`Pizarra ${i}`}})}))
        store.put(board)
      }
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
    });db.close()
  })
  await page.reload();await expect(page.locator('.app')).toBeVisible()
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable')
  async function sample(){
    await cdp.send('HeapProfiler.collectGarbage')
    return {heap:(await cdp.send('Performance.getMetrics')).metrics.find(metric=>metric.name==='JSHeapUsedSize').value,
      ...await page.evaluate(()=>({canvases:document.querySelectorAll('.app canvas').length,
        bytes:[...document.querySelectorAll('.app canvas')].reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0)}))}
  }
  const samples=[await sample()]
  const canvas=page.locator('.app canvas').first()
  for(let i=0;i<20;i++){
    await canvas.press('t');await canvas.click({position:{x:650+i%5*100,y:250+Math.floor(i/5)*60}})
    const editor=page.locator('textarea.text-editor')
    await editor.fill(`Texto ${i}`);await editor.press('Escape')
    await page.getByRole('button',{name:'Conectar objetos',exact:true}).click()
    await page.mouse.move(600,550+i*5);await page.mouse.down();await page.mouse.move(950,550+i*5,{steps:3});await page.mouse.up()
    if(i===9)samples.push(await sample())
  }
  samples.push(await sample())
  expect(samples.every(sample=>sample.canvases===samples[0].canvases&&sample.bytes===samples[0].bytes)).toBe(true)
  expect(samples[2].heap-samples[1].heap).toBeLessThan(8*1024*1024)
  expect(pdfRequests).toBe(0)
  await expect(page.locator('.board-pdf-reader iframe')).toHaveCount(0)
  expect(await page.evaluate(()=>performance.getEntriesByType('resource').some(entry=>/\/mathRuntime-/.test(entry.name)))).toBe(false)
  testInfo.annotations.push({type:'memory',description:JSON.stringify(samples)})
})

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
  expect(first).toBeLessThanOrEqual(1024)
  // Resolution changes only after crossing a level, rather than at every zoom tick.
  for (let i = 0; i < 4; i++) await page.locator('.zoom-controls').getByRole('button', { name: 'Acercar', exact: true }).click()
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

test('derived previews survive reopen offline, preserve alpha, and tolerate unavailable preview storage', async ({ page }) => {
  await page.addInitScript(() => {
    window.previewInputs = []
    const decode = window.createImageBitmap.bind(window)
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args)
      if (args[1]?.resizeWidth) window.previewInputs.push({ width: bitmap.width, blobBytes: args[0].size })
      return bitmap
    }
  })
  await openLocal(page)
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e21'; ctx.fillRect(800, 600, 1600, 1200)
    return canvas.toDataURL().split(',')[1]
  })
  await page.locator('input[type=file][accept*="image/svg+xml"]').setInputFiles({ name: 'alpha.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect.poll(() => page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'pizarra-image-previews-v1')) return 0
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-image-previews-v1'); r.onsuccess = () => resolve(r.result) })
    const count = await new Promise(resolve => { const r = db.transaction('blobs').objectStore('blobs').count(); r.onsuccess = () => resolve(r.result) }); db.close(); return count
  })).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.previewInputs.length)).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(800)
  await page.reload(); await expect(page.locator('.app')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.previewInputs.length)).toBe(1)
  const alpha = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-image-previews-v1'); r.onsuccess = () => resolve(r.result) })
    const blobs = await new Promise(resolve => { const r = db.transaction('blobs').objectStore('blobs').getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
    const bitmap = await createImageBitmap(blobs[0]), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3]]
  })
  expect(alpha).toEqual([0, 255])
  // Failure of the disposable cache must not prevent drawing originals.
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (name, ...args) => { if (name.startsWith('pizarra-image-previews')) throw new DOMException('Denied', 'SecurityError'); return open(name, ...args) }
  })
  await page.reload(); await expect(page.locator('.app')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.previewInputs.length)).toBeGreaterThanOrEqual(2)
})

test('a JPEG photograph keeps its original bytes and native aspect ratio', async ({ page }) => {
  await openLocal(page)
  const bytes = await readFile(new URL('../../../sintesis/sintesis-fondo.jpg', import.meta.url))
  await page.locator('input[type=file][accept*="image/svg+xml"]').setInputFiles({ name: 'photograph.jpg', mimeType: 'image/jpeg', buffer: bytes })
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('boards').objectStore('boards').getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
    return rows[0]?.content.media.length ?? 0
  })).toBe(1)
  const result = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pizarra-dispositivo', 1); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('boards').objectStore('boards').getAll(); r.onsuccess = () => resolve(r.result) })
    const item = rows[0].content.media[0]
    const blob = await new Promise(resolve => { const r = db.transaction('assets').objectStore('assets').get('device:' + item.assetId); r.onsuccess = () => resolve(r.result) }); db.close()
    return { ratio: item.width / item.height, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))] }
  })
  expect(result.ratio).toBeCloseTo(2400 / 1597, 8)
  const { createHash } = await import('node:crypto')
  expect(Buffer.from(result.hash).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
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
