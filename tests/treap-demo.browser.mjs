import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'

async function lessonHtml(lesson) {
  const bundle = await build({ entryPoints: ['lib/treap-demo/player.mjs'], bundle: true, write: false, format: 'iife' })
  const payload = JSON.stringify(lesson).replace(/</g, '\\u003c')
  return (await readFile('lib/treap-demo/template.html', 'utf8')).replace('<script>/* PLAYER */</script>', () => '<script id="treap-lesson" type="application/json">' + payload + '</script><script>' + bundle.outputFiles[0].text + '</script>')
}

test('long numbers fit in capsules and text is displayed literally', async () => {
  const lesson = {
    version: 1, catalog: [{ id: 'a', key: -123456789012345, priority: 1.7976931348623157e308 }, { id: 'b', key: 0.000000000000123, priority: 5e-200 }],
    initial: { root: 'a', children: { a: [null, 'b'], b: [null, null] } },
    steps: [{ title: 'Valores largos', text: '</script><script>window.injected=true</script>' + ' Explicación extensa para comprobar el panel de lectura.'.repeat(16), badge: 'Sin recorte', operation: { type: 'check' } }],
  }
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 667 } })
  try {
    await page.setContent(await lessonHtml(lesson))
    await page.locator('.node').first().waitFor()
    assert.equal(await page.locator('.node').count(), 2)
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.node')].every(node => {
      const rect = node.querySelector('rect').getBBox()
      return [...node.querySelectorAll('text')].every(text => {
        const b = text.getBBox()
        return b.x >= rect.x + 4 && b.x + b.width <= rect.x + rect.width - 4 && b.y >= rect.y && b.y + b.height <= rect.y + rect.height
      })
    })), true)
    assert.equal(await page.evaluate(() => 'injected' in window), false)
    assert.equal(await page.locator('#explanation').textContent(), lesson.steps[0].text)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.setViewportSize({ width: 1366, height: 768 })
    assert.equal(await page.locator('aside').evaluate(e => {
      const footer = document.querySelector('footer').getBoundingClientRect()
      return e.getBoundingClientRect().bottom <= footer.top && e.scrollHeight > e.clientHeight
    }), true)
    assert.equal(await page.locator('#explanation').evaluate(e => {
      const range = document.createRange(); range.selectNodeContents(e)
      const box = e.getBoundingClientRect()
      return [...range.getClientRects()].every(r => r.left >= box.left - 1 && r.right <= box.right + 1)
    }), true)
    await page.screenshot({ path: 'test-results/treap-long-values.png', fullPage: true })
    const bad = structuredClone(lesson)
    bad.steps.push({ ...bad.steps[0], operation: { type: 'insert', node: 'missing' } })
    await page.setContent(await lessonHtml(bad))
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /Paso 2/)
    assert.equal(await page.locator('.node').count(), 0)
    assert.equal(await page.locator('#next').isDisabled(), true)
  } finally { await browser.close() }
})

test('player renders a deep tree using the generic layout without clipping nodes', async () => {
  const catalog = Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, key: i / 10, priority: 99 - i }))
  catalog[23].priority = 500 // A real violation with IDs unrelated to the demo.
  const children = Object.fromEntries(catalog.map((n, i) => [n.id, [null, catalog[i + 1]?.id ?? null]]))
  const lesson = { version: 1, catalog, initial: { root: 'n0', children }, steps: [{ title: '?rbol profundo', text: 'Prueba de distribuci?n', badge: '24 nodos', operation: { type: 'observe' } }] }
  const html = await lessonHtml(lesson)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 667 }, reducedMotion: 'reduce' })
  try {
    await page.context().setOffline(true)
    await page.setContent(html)
    assert.equal(await page.locator('.node').count(), 24)
    assert.equal(await page.locator('#edges path.conflict').count(), 1)
    assert.equal(await page.locator('#edges path.conflict').getAttribute('data-edge'), 'n22:n23')
    assert.equal(await page.evaluate(() => {
      const svg = document.querySelector('#scene'), box = svg.viewBox.baseVal
      return [...document.querySelectorAll('.node')].every(n => {
        const p = n.transform.baseVal.consolidate().matrix
        return p.e - 56 >= 0 && p.e + 56 <= box.width && p.f - 31 >= 0 && p.f + 31 <= box.height
      }) && document.querySelector('.stage').scrollHeight > document.querySelector('.stage').clientHeight && document.documentElement.scrollWidth <= innerWidth
    }), true)
    await page.locator('.stage').evaluate(e => { e.scrollTop = e.scrollHeight; e.scrollLeft = e.scrollWidth })
    const last = await page.locator('[data-node="n23"]').boundingBox()
    const stage = await page.locator('.stage').boundingBox()
    assert.ok(last.y >= stage.y && last.y + last.height <= stage.y + stage.height)
  } finally { await browser.close() }
})

test('standalone offline demo: navigation, attached edges, rapid cancellation, responsive layout and reduced motion', async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const errors = [], requests = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()) })
  const settled = () => page.waitForFunction(() => document.body.dataset.animating === 'false')
  try {
    await page.context().setOffline(true)
    await page.goto(pathToFileURL(resolve('public/demos/treap-d3.html')).href)
    await page.locator('[data-node="40"]').waitFor()
    assert.equal(await page.locator('.node').count(), 1)
    for (let step = 2; step <= 6; step++) {
      await page.locator('#next').click()
      if (step === 5) {
        await page.waitForFunction(() => {
          const p = document.querySelector('[data-node="30"]').transform.baseVal.consolidate().matrix
          return p.f > 202 && p.f < 314
        })
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#edges path')].every(edge => {
          const [from, to] = edge.dataset.edge.split(':')
          const a = document.querySelector(`[data-node="${from}"]`).transform.baseVal.consolidate().matrix
          const b = document.querySelector(`[data-node="${to}"]`).transform.baseVal.consolidate().matrix
          const start = edge.getPointAtLength(0), end = edge.getPointAtLength(edge.getTotalLength())
          return Math.hypot(start.x - a.e, start.y - a.f - 31) < .1 && Math.hypot(end.x - b.e, end.y - b.f + 31) < .1
        })), true)
      }
      await settled()
      assert.equal(await page.locator('body').getAttribute('data-step'), String(step))
    }
    assert.equal(await page.locator('#next').isDisabled(), true)
    await page.locator('#replay').click(); await settled()
    await page.locator('#prev').click(); await settled()
    await page.locator('#replay').click()
    await page.waitForFunction(() => document.body.dataset.animating === 'true')
    await page.getByRole('button', { name: 'Ir al paso 2', exact: true }).click()
    await settled()
    assert.equal(await page.locator('.node').count(), 4)
    await page.waitForTimeout(950)
    assert.equal(await page.locator('.node').count(), 4)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const [width, height] of [[1366,768], [1280,480], [390,667]]) {
      await page.setViewportSize({ width, height })
      for (let step = 1; step <= 6; step++) {
        await page.getByRole('button', { name: `Ir al paso ${step}`, exact: true }).click()
        assert.equal(await page.locator('body').getAttribute('data-animating'), 'false')
        assert.equal(await page.evaluate(() => {
          const stage = document.querySelector('.stage').getBoundingClientRect()
          const aside = document.querySelector('aside').getBoundingClientRect()
          const nodes = [...document.querySelectorAll('.node')].map(n => n.getBBox())
          const labelsFit = nodes.every(n => n.width <= 115 && n.height <= 65)
          return document.documentElement.scrollWidth <= innerWidth && labelsFit &&
            (aside.left >= stage.right - 1 || aside.top >= stage.bottom - 1)
        }), true, `${width}x${height}, step ${step}`)
        for (const id of ['prev', 'next', 'replay']) {
          await page.locator(`#${id}`).scrollIntoViewIfNeeded()
          assert.equal(await page.locator(`#${id}`).isVisible(), true)
        }
      }
      const stage = page.locator('.stage')
      if (width === 390) assert.equal(await stage.evaluate(e => e.scrollWidth > e.clientWidth), true)
    }
    await page.keyboard.press('ArrowLeft')
    assert.equal(await page.locator('body').getAttribute('data-step'), '5')
    await page.screenshot({ path: 'test-results/treap-mobile.png', fullPage: true })
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('button', { name: 'Ir al paso 4', exact: true }).click()
    assert.equal(await page.locator('footer').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight), true)
    await page.screenshot({ path: 'test-results/treap-desktop.png', fullPage: true })
    assert.deepEqual(errors, []); assert.deepEqual(requests, [])
  } finally { await browser.close() }
})

test('demo survives the existing HTML importer and opaque sandbox offline', async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    await page.route('https://treap.test/**', async route => route.fulfill({
      body: route.request().url().endsWith('.js') ? await readFile('public/pdfjs/web/viewer-explanation-import.js') : '<iframe sandbox="allow-scripts" style="width:100%;height:700px"></iframe>',
      contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html',
    }))
    await page.goto('https://treap.test/')
    const html = await page.evaluate(async source => (await import('/import.js')).preparePdfExplanationHtml(source), await readFile('public/demos/treap-d3.html', 'utf8'))
    await page.context().setOffline(true)
    await page.evaluate(html => { document.querySelector('iframe').srcdoc = html }, html)
    const frame = page.frameLocator('iframe')
    await frame.locator('#step-title').waitFor()
    await frame.getByRole('button', { name: 'Ir al paso 6', exact: true }).click()
    await frame.locator('body[data-animating="false"][data-step="6"]').waitFor()
    assert.match(await frame.locator('#explanation').textContent(), /10 < 20 < 30 < 40 < 60/)
  } finally { await browser.close() }
})
