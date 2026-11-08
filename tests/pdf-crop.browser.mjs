import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { pdfFixture } from './helpers/pdf-fixture.mjs'

test('selection menu stays below its button, SVG respects the range, and saved crops reopen HTML pointers', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  let croppedBytes
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://crop.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe></iframe><script>
      addEventListener('message',async event=>{
        if(event.data?.type!=='uploadPracticeFragment')return;
        window.saved={bytes:Array.from(new Uint8Array(await event.data.payload.blob.arrayBuffer())),name:event.data.payload.fileName};
        event.source.postMessage({type:'practiceFragmentUploadState',status:'success'},location.origin);
      });
    </script>` })
    if (url.pathname === '/sample.pdf') return route.fulfill({ body: pdfFixture(4), contentType: 'application/pdf' })
    if (url.pathname === '/cropped.pdf') return route.fulfill({ body: croppedBytes, contentType: 'application/pdf' })
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} })
    try {
      return route.fulfill({ body: await readFile(`public${decodeURIComponent(url.pathname)}`), contentType:
        /\.(mjs|js)$/.test(url.pathname) ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream' })
    } catch { return route.fulfill({ status: 404 }) }
  })
  try {
    await page.goto('https://crop.test/')
    await page.evaluate(async () => {
      const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('source-key'))), b => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(`pdf-explanations:${key}`, JSON.stringify({ version: 1, transcriptions: {}, entries: [
        { id: 'html-original', question: 'HTML de la página dos', html: '<!doctype html><html><body><button onclick="this.textContent=\'Activo\'">Interactuar</button></body></html>',
          annotation: { annotationType: 3, pageIndex: 1, rect: [24, 480, 300, 510], rotation: 0, color: [126, 70, 190], fontSize: 12, value: '★ HTML de la página dos' } },
        { id: 'outside', question: 'Fuera del recorte', html: '<html><body>Fuera</body></html>',
          annotation: { annotationType: 3, pageIndex: 0, rect: [24, 480, 300, 510], rotation: 0, color: [126, 70, 190], fontSize: 12, value: '★ Fuera' } },
      ] }))
      const params = new URLSearchParams({ file: '/sample.pdf', key: 'source-key', materialId: '1', subjectId: 'test', subjectName: 'Test', sessionDate: '2026-11-07', weekNumber: '30', materialType: 'theory', fileName: 'Original.pdf' })
      document.querySelector('iframe').src = `/pdfjs/web/viewer.html?${params}`
    })
    const frame = page.frameLocator('iframe')
    await frame.locator('#selectionToolsButton').waitFor({ timeout: 30000 })
    const pdfFrame = page.frames().find(frame => frame.url().includes('viewer.html'))
    await pdfFrame.waitForFunction(() => window.PDFViewerApplication?.pdfDocument?.numPages === 4)
    await frame.locator('#selectionToolsButton').click()
    const trigger = await frame.locator('#selectionToolsButton').boundingBox()
    const menu = await frame.locator('#selectionToolsMenu').boundingBox()
    assert.ok(menu.y >= trigger.y + trigger.height && menu.y < trigger.y + trigger.height + 10)
    assert.ok(Math.abs(menu.x - trigger.x) < 2)
    await frame.locator('.page[data-page-number="2"]').click({ position: { x: 80, y: 80 } })
    await frame.locator('.page[data-page-number="3"]').click({ position: { x: 80, y: 80 } })
    await frame.locator('#selectionToolsButton').click()
    const downloadPromise = page.waitForEvent('download')
    await frame.locator('#exportSelectedSvgButton').click()
    const download = await downloadPromise
    const svg = await readFile(await download.path(), 'utf8')
    assert.equal((svg.match(/<image /g) || []).length, 2)
    assert.match(download.suggestedFilename(), /paginas-2-3/)
    const allDownloadPromise = page.waitForEvent('download')
    await frame.locator('#exportSvgButton').click()
    const allDownload = await allDownloadPromise
    assert.equal(((await readFile(await allDownload.path(), 'utf8')).match(/<image /g) || []).length, 4)
    await frame.locator('#pdfjs-custom-cut-button').click()
    await frame.locator('#pdfjs-custom-modal-input').fill('Recorte')
    await frame.locator('#pdfjs-custom-modal-confirm').click()
    await page.waitForFunction(() => window.saved)
    const saved = await page.evaluate(() => window.saved)
    croppedBytes = Buffer.from(saved.bytes)
    const links = await pdfFrame.evaluate(async bytes => {
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise
      const data = JSON.parse(new TextDecoder().decode((await pdf.getAttachments())['cursado-explanation-links.json'].content))
      const count = pdf.numPages
      await pdf.destroy()
      return { data, count }
    }, saved.bytes)
    assert.equal(links.count, 2)
    assert.equal(links.data.entries.length, 1)
    assert.equal(links.data.entries[0].annotation.pageIndex, 0)
    assert.equal(links.data.entries[0].htmlReference.id, 'html-original')
    assert.equal(links.data.entries[0].html, undefined)
    await page.evaluate(() => {
      const url = new URL(document.querySelector('iframe').src)
      url.searchParams.set('file', '/cropped.pdf'); url.searchParams.set('key', 'cropped-key')
      document.querySelector('iframe').src = url.href
    })
    await frame.locator('.freeTextEditor[data-explanation-id]').first().waitFor({ timeout: 30000 })
    await frame.locator('.freeTextEditor[data-explanation-id]').first().click()
    const html = frame.frameLocator('.pdf-explanation-result iframe')
    await html.getByRole('button', { name: 'Interactuar' }).click()
    assert.equal(await html.getByRole('button', { name: 'Activo' }).count(), 1)
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('pdf-explanations:') && localStorage.getItem(key).includes('html-original') && localStorage.getItem(key).includes('Interactuar'))
      const source = JSON.parse(localStorage.getItem(key))
      source.entries[0].html = '<html><body>HTML original actualizado</body></html>'
      localStorage.setItem(key, JSON.stringify(source))
    })
    await frame.getByRole('button', { name: 'Recargar HTML', exact: true }).click()
    await html.getByText('HTML original actualizado', { exact: true }).waitFor()
    const recropped = await page.frames().find(frame => frame.url().includes('viewer.html')).evaluate(() => window.exportPdfFragmentExplanations([{ pageNumber: 1 }]))
    assert.equal(recropped.entries[0].htmlReference.id, 'html-original', 'recropping keeps the canonical HTML pointer')
    assert.equal(recropped.entries[0].html, undefined)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
