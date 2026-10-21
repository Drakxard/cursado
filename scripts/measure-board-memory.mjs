// Synthetic, repeatable Chromium measurement; no access to personal boards.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] })
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  const generator = await browser.newPage()
  const images = []
  for (let i = 0; i < 12; i++) images.push(Buffer.from(await generator.evaluate(i => {
    const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 3200, 2400)
    ctx.fillStyle = '#123'; ctx.font = '80px sans-serif'; ctx.fillText(`Document ${i}`, 100, 150)
    for (let n = 0; n < 150; n++) { ctx.fillStyle = `hsl(${n * 13 + i},60%,40%)`; ctx.fillRect(100, 200 + n * 13, 2500 - n * 7, 5) }
    const result = canvas.toDataURL('image/png').split(',')[1]; canvas.width = canvas.height = 0; return result
  }, i), 'base64'))
  await generator.close()
  let content = { strokes: [], texts: [], shapes: [], graphs: [], tables: [], videos: [], camera: { x: 0, y: 0, zoom: 1 },
    media: images.map((_, i) => ({ id: `item-${i}`, assetId: `image-${i}`, kind: 'image', name: `Document ${i}`, x: 35 + i % 4 * 320, y: 210 + Math.floor(i / 4) * 220, width: 300, height: 200 })) }
  let requests = 0, version = 0
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/pizarra(?=\/)/, '')
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/auth/me') return json({ id: 'memory', name: 'Memory', display_name: 'Memory' })
    if (path === '/api/library') return json({ folders: [], boards: [{ id: 'memory', name: 'Memory', role: 'editor', version }] })
    if (path === '/api/boards/memory') {
      if (route.request().method() === 'PUT') { content = route.request().postDataJSON().content; return json({ version: ++version }) }
      return json({ id: 'memory', name: 'Memory', content, version })
    }
    if (path.startsWith('/api/assets/image-')) { requests++; return route.fulfill({ contentType: 'image/png', body: images[Number(path.split('-').at(-1))] }) }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const root = await browser.newBrowserCDPSession()
  async function measure(label) {
    await session.send('HeapProfiler.collectGarbage')
    const metrics = (await session.send('Performance.getMetrics')).metrics
    const processes = (await root.send('SystemInfo.getProcessInfo')).processInfo
    let workingSetBytes = null
    if (process.platform === 'win32') workingSetBytes = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${processes.map(p => p.id).join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`], { encoding: 'utf8' }).trim())
    return { label, workingSetBytes, jsHeapBytes: metrics.find(m => m.name === 'JSHeapUsedSize')?.value,
      dom: await session.send('Memory.getDOMCounters'), surfaces: await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, canvasBytes: [...document.querySelectorAll('canvas')].reduce((n, c) => n + c.width * c.height * 4, 0), frames: document.querySelectorAll('iframe').length })), workers: (await root.send('Target.getTargets')).targetInfos.filter(t => t.type.includes('worker')).length }
  }
  await page.goto('http://127.0.0.1:4173/pizarra/')
  await page.waitForFunction(() => document.querySelector('.app canvas'))
  for (let i = 0; i < 100 && requests < 12; i++) await page.waitForTimeout(100)
  if (requests < 12) throw new Error(`Only loaded ${requests}/12 images`)
  await page.waitForTimeout(2000)
  const results = [await measure('12 visible 3200x2400 originals')]
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(650, 450); await page.mouse.wheel(0, 1500); await page.waitForTimeout(100)
    await page.mouse.wheel(0, -1500); await page.waitForTimeout(100)
  }
  await page.waitForTimeout(1000)
  results.push(await measure('after 10 camera cycles'))
  const report = { fixture: '12 originals, 3200x2400, displayed 300x200; 1366x900 DPR 1', note: 'Working set sums Chromium processes, including browser/GPU; it is not Chrome tab tooltip memory.', requests, results }
  const out = process.argv[2]
  if (out) writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
