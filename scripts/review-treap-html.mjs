import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

// Local browser review only: never calls a model or reads credentials.
const [input] = process.argv.slice(2)
if (!input) throw new Error('Uso: node scripts/review-treap-html.mjs ruta/al/archivo.html')
const directory = dirname(input), name = basename(input, '.html')
const html = await readFile(input, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const errors = [], requests = [], checks = []
page.on('pageerror', e => errors.push(e.message))
page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()) })
const settled = () => page.waitForFunction(() => document.body.dataset.animating === 'false')
try {
  await page.context().setOffline(true)
  await page.goto(pathToFileURL(resolve(input)).href)
  await page.locator('.node').first().waitFor()
  const count = await page.locator('#steps button').count()
  for (let step = 1; step <= count; step++) {
    if (step > 1) {
      await page.locator('#next').click()
      // Read SVG node and edge geometry in the same JS task, including frames
      // in which the nodes are still moving.
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('#edges path')].every(edge => {
        const [from, to] = edge.dataset.edge.split(':')
        const a = document.querySelector(`[data-node="${from}"]`).transform.baseVal.consolidate().matrix
        const b = document.querySelector(`[data-node="${to}"]`).transform.baseVal.consolidate().matrix
        const start = edge.getPointAtLength(0), end = edge.getPointAtLength(edge.getTotalLength())
        return Math.hypot(start.x - a.e, start.y - a.f - 31) < .1 && Math.hypot(end.x - b.e, end.y - b.f + 31) < .1
      })), true)
    }
    await settled()
    await page.screenshot({ path: `${directory}/${name}-step-${step}.png`, fullPage: true })
    checks.push({ step, conflicts: await page.locator('#edges path.conflict').count() })
  }
  if (count > 1) {
    await page.locator('#replay').click(); await settled()
    await page.locator('#prev').click(); await settled()
    await page.locator('#replay').click()
    await page.getByRole('button', { name: 'Ir al paso 1', exact: true }).click()
    await settled(); await page.waitForTimeout(900)
    assert.equal(await page.locator('body').getAttribute('data-step'), '1')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [width, height] of [[1366,768], [1280,480], [390,667]]) {
    await page.setViewportSize({ width, height })
    for (let step = 1; step <= count; step++) {
      await page.getByRole('button', { name: `Ir al paso ${step}`, exact: true }).click()
      assert.equal(await page.evaluate(() => {
        const aside = document.querySelector('aside').getBoundingClientRect(), stage = document.querySelector('.stage').getBoundingClientRect()
        const footer = document.querySelector('footer').getBoundingClientRect()
        return document.documentElement.scrollWidth <= innerWidth && (aside.left >= stage.right - 1 || aside.top >= stage.bottom - 1) && aside.bottom <= footer.top + 1 && stage.bottom <= footer.top + 1 && document.body.dataset.animating === 'false'
      }), true)
      await page.locator('#next').scrollIntoViewIfNeeded()
      assert.equal(await page.locator('#next').isVisible(), true)
    }
    checks.push({ viewport: `${width}x${height}`, passed: true })
  }
  await page.goto('about:blank')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.setContent('<iframe sandbox="allow-scripts" style="width:100%;height:730px"></iframe>')
  await page.evaluate(html => { document.querySelector('iframe').srcdoc = html }, html)
  const frame = page.frameLocator('iframe')
  await frame.locator('#step-title').waitFor()
  await frame.getByRole('button', { name: `Ir al paso ${count}`, exact: true }).click()
  await frame.locator(`body[data-step="${count}"][data-animating="false"]`).waitFor()
  checks.push({ sandbox: true, passed: true })
  assert.deepEqual(errors, []); assert.deepEqual(requests, [])
  const report = { passed: true, checks, requests: 0, errors, note: 'Geometría y ejecución verificadas; las capturas requieren revisión visual.' }
  await writeFile(`${directory}/${name}-browser-review.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
