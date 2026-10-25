import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium, expect } from '@playwright/test'

const origin = 'https://board-memory.test'
const fixture = '/pdfjs/web/compressed.tracemonkey-pldi-09.pdf'
const viewerUrl = board => `/pdfjs/web/viewer.html?file=${encodeURIComponent(fixture)}&sharedBoardReader=1${board ? '&boardReader=1' : ''}#zoom=180`

async function setup(t, { delayed = false } = {}) {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => { if (errors.length) t.diagnostic(JSON.stringify(errors)) })
  const directory = resolve('public')
  let release, pdfRequests = 0
  const gate = new Promise(resolve => { release = resolve })
  await page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style><script>
      window.ready=0;
      addEventListener('message',e=>{if(e.origin===location.origin&&e.source===document.querySelector('iframe')?.contentWindow&&e.data?.type==='board-reader:ready')window.ready++});
      window.openReader=src=>{document.querySelector('iframe')?.remove();const frame=document.createElement('iframe');frame.src=src;document.body.append(frame)};
      window.visibility=visible=>document.querySelector('iframe').contentWindow.postMessage({type:'board-reader:visibility',visible},location.origin);
    </script>` })
    const file = resolve(directory, '.' + path)
    assert.ok(file.startsWith(directory + sep))
    if (path === fixture) { pdfRequests++; if (delayed) await gate }
    try {
      await route.fulfill({ body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.ftl': 'text/plain', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream' })
    } catch { await route.fulfill({ status: 404, body: '' }).catch(() => {}) }
  })
  await page.goto(origin)
  const cdp = await context.newCDPSession(page)
  const browserCdp = await browser.newBrowserCDPSession()
  await cdp.send('Performance.enable')
  async function sample(label, includeWorkingSet = true) {
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics = (await cdp.send('Performance.getMetrics')).metrics
    let workingSetBytes = null
    if (includeWorkingSet && process.platform === 'win32') {
      const processes=(await browserCdp.send('SystemInfo.getProcessInfo')).processInfo
      workingSetBytes=Number(execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${processes.map(item=>item.id).join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`],{encoding:'utf8'}).trim())
    }
    return { label, heapBytes: metrics.find(item => item.name === 'JSHeapUsedSize')?.value,
      workingSetBytes,
      dom: await cdp.send('Memory.getDOMCounters'), frames: page.frames().length - 1, workers: page.workers().length,
      ...await page.frameLocator('iframe').locator('body').evaluate(() => {
        const canvases = [...document.querySelectorAll('canvas')].filter(canvas => canvas.width && canvas.height)
        return { canvases: canvases.length, canvasBytes: canvases.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0) }
      }) }
  }
  return { page, errors, release, sample, requests: () => pdfRequests }
}

async function rendered(pdf, number) {
  await expect.poll(() => pdf.locator('body').evaluate((_body, number) => {
    const view = window.PDFViewerApplication?.pdfViewer?.getPageView(number - 1)
    return view?.renderingState === 3 && !!view.canvas?.width
  }, number), { timeout: 20000 }).toBe(true).catch(async error => {
    console.error('PDF render diagnostics', await pdf.locator('body').evaluate(() => ({
      text:document.body.innerText.slice(-1000),pages:window.PDFViewerApplication?.pdfDocument?.numPages,
      current:window.PDFViewerApplication?.pdfViewer?.currentPageNumber,
      states:window.PDFViewerApplication?.pdfViewer?._pages?.slice(0,3).map(p=>({id:p.id,state:p.renderingState,canvas:!!p.canvas?.width})),
    })))
    throw error
  })
}

test('real PDF: bounded cache, retained document, twenty visibility cycles and worker disposal', { timeout: 120000 }, async t => {
  const { page, errors, sample, requests } = await setup(t)
  const reports = []
  for (const board of [false, true]) {
    await page.evaluate(url => window.openReader(url), viewerUrl(board))
    const pdf = page.frameLocator('iframe')
    await rendered(pdf, 1)
    reports.push(await sample(board ? 'board-initial' : 'default-initial'))
    for (let number = 1; number <= 14; number++) {
      await pdf.locator('body').evaluate((_body, number) => { window.PDFViewerApplication.pdfViewer.currentPageNumber = number }, number)
      await rendered(pdf, number)
    }
    const after = await sample(board ? 'board-after-14-pages' : 'default-after-14-pages')
    reports.push(after)
    if (!board) {
      assert.ok(after.canvases >= 10)
      continue
    }
    assert.ok(after.canvases <= 3)
    assert.ok(after.canvasBytes <= 64 * 1024 * 1024)
    await pdf.locator('body').evaluate(() => {
      window.retainedDocument = PDFViewerApplication.pdfDocument
      // Unsaved annotations must survive hiding, not just reading coordinates.
      PDFViewerApplication.pdfDocument.annotationStorage.setValue('memory-test', { value: 'pending' })
    })
    const beforeRequests = requests()
    const beforeWorkers = page.workers().length
    for (let cycle = 0; cycle < 20; cycle++) {
      await page.evaluate(() => window.visibility(false))
      await expect.poll(() => pdf.locator('body').evaluate(() => PDFViewerApplication.pdfViewer.boardReaderPaused)).toBe(true)
      assert.equal((await sample('hidden', false)).canvases, 1)
      // Self-sent messages and messages from sibling frames must be ignored.
      await pdf.locator('body').evaluate(() => window.postMessage({ type: 'board-reader:visibility', visible: true }, location.origin))
      assert.equal(await pdf.locator('body').evaluate(() => PDFViewerApplication.pdfViewer.boardReaderPaused), true)
      await page.evaluate(() => window.visibility(true))
      await expect.poll(() => pdf.locator('body').evaluate(() => PDFViewerApplication.pdfViewer.boardReaderPaused)).toBe(false)
      await rendered(pdf, 14)
    }
    assert.equal(requests(), beforeRequests)
    assert.equal(page.workers().length, beforeWorkers)
    assert.deepEqual(await pdf.locator('body').evaluate(() => ({
      same: retainedDocument === PDFViewerApplication.pdfDocument,
      page: PDFViewerApplication.pdfViewer.currentPageNumber, zoom: PDFViewerApplication.pdfViewer.currentScale,
      annotation: PDFViewerApplication.pdfDocument.annotationStorage.getValue('memory-test', {}).value,
    })), { same: true, page: 14, zoom: 1.8, annotation: 'pending' })
    reports.push(await sample('board-after-20-visibility-cycles'))
  }
  await page.evaluate(() => document.querySelector('iframe').remove())
  await expect.poll(() => page.workers().length).toBe(0)
  assert.deepEqual(errors, [])
  t.diagnostic(JSON.stringify({ fixture: '14-page PDF; 1366x768; DPR 1; zoom 180%', reports }))
})

test('hide while loading, resume, replace, and close a pending real PDF reader', { timeout: 60000 }, async t => {
  const { page, errors, release } = await setup(t, { delayed: true })
  await page.evaluate(url => window.openReader(url), viewerUrl(true))
  await expect.poll(() => page.evaluate(() => window.ready)).toBe(1)
  const pdf = page.frameLocator('iframe')
  await page.evaluate(() => window.visibility(false))
  await expect.poll(() => pdf.locator('body').evaluate(() => PDFViewerApplication.pdfViewer.boardReaderPaused)).toBe(true)
  release()
  await expect.poll(() => pdf.locator('body').evaluate(() => PDFViewerApplication.pdfDocument?.numPages)).toBe(14)
  assert.equal(await pdf.locator('body').evaluate(() => [...document.querySelectorAll('.page canvas')].filter(canvas => canvas.width).length), 0)
  await page.evaluate(() => window.visibility(true))
  await rendered(pdf, 1)
  await page.evaluate(url => window.openReader(url), viewerUrl(true))
  await rendered(pdf, 1)
  await expect.poll(() => page.workers().length).toBe(1)
  // A new frame removed before completing setup must not retain a worker.
  await page.evaluate(url => { window.openReader(url); document.querySelector('iframe').remove() }, viewerUrl(true))
  await expect.poll(() => page.workers().length).toBe(0)
  assert.deepEqual(errors, [])
})

test('real PDF at 300% accounts for detail canvases and cancels pending rendering on hide', { timeout: 60000 }, async t => {
  const {page,errors,sample}=await setup(t)
  await page.evaluate(url=>window.openReader(url),viewerUrl(true).replace('zoom=180','zoom=300'))
  const pdf=page.frameLocator('iframe')
  await rendered(pdf,1)
  for(const number of [4,5,6]) {
    await pdf.locator('body').evaluate((_body,number)=>{PDFViewerApplication.pdfViewer.currentPageNumber=number},number)
    await rendered(pdf,number)
  }
  const stats=await sample('board-300-percent')
  t.diagnostic(JSON.stringify({...stats,dimensions:await pdf.locator('body').evaluate(()=>[...document.querySelectorAll('.page canvas')].map(canvas=>({width:canvas.width,height:canvas.height,page:canvas.closest('.page').dataset.pageNumber})))}))
  assert.ok(stats.canvasBytes<=64*1024*1024)
  assert.ok(await pdf.locator('body').evaluate(()=>document.querySelectorAll('.page:has(canvas)').length)<=3)
  assert.equal(await pdf.locator('body').evaluate(()=>PDFViewerApplication.pdfViewer.currentScale),3)
  // Hide in the same turn that schedules rendering of a different page.
  await pdf.locator('body').evaluate(()=>{
    PDFViewerApplication.pdfViewer.currentPageNumber=7
    PDFViewerApplication.pdfViewer.setBoardReaderVisible(false)
  })
  assert.equal(await pdf.locator('body').evaluate(()=>PDFViewerApplication.pdfViewer.boardReaderPaused),true)
  await page.evaluate(()=>window.visibility(true))
  await rendered(pdf,7)
  assert.deepEqual(errors,[])
})
