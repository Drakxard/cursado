import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { chromium } from "@playwright/test"
import { graphFixture } from './helpers/explanation-graphs-fixture.mts'

test('a saved graph HTML is upgraded offline using its data without executing its old player', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 480 }, reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://import.test/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('.js')) return route.fulfill({ body: await readFile('public/pdfjs/web/viewer-explanation-import.js'), contentType: 'text/javascript' })
    return route.fulfill({ body: '<!doctype html><html><body style="margin:0"><iframe sandbox="allow-scripts" style="display:block;border:0;width:100vw;height:100vh"></iframe></body></html>', contentType: 'text/html' })
  })
  try {
    await page.goto('https://import.test/')
    const source = '<!doctype html><html><head><style>body{background:black}#scene{min-width:1600px}</style></head><body><div id="stage"><svg id="scene"></svg></div>' +
      '<script id="graph-data" type="application/json">' + JSON.stringify(graphFixture) + '</script><script>window.oldGraphPlayerRan=true</script></body></html>'
    const html = await page.evaluate(async source => {
      const path = '/viewer-explanation-import.js'
      const module = await import(/* webpackIgnore: true */ path)
      return module.preparePdfExplanationHtml(source)
    }, source)
    assert.ok(!html.includes('oldGraphPlayerRan'))
    await page.context().setOffline(true)
    await page.evaluate(html => { document.querySelector('iframe')!.srcdoc = html }, html)
    const frame = page.frameLocator('iframe')
    await frame.locator('body[data-graph-engine="d3"]').waitFor()
    assert.equal(await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(241, 245, 249)')
    assert.equal(await frame.getByRole('heading', { name: graphFixture.titulo, exact: true }).count(), 1)
    await frame.getByRole('button', { name: 'Siguiente', exact: true }).click()
    assert.ok((await frame.locator('#counter').textContent())!.includes('2'))
    assert.deepEqual(JSON.parse((await frame.locator('#graph-data').textContent())!), graphFixture)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test("imported AVL compiles Tailwind offline and fits the PDF iframe at different sizes", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors: string[] = [], violations: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("console", message => { if (message.text().includes("Content Security Policy")) violations.push(message.text()) })
  await page.route("https://import.test/**", async route => {
    if (new URL(route.request().url()).pathname.endsWith(".js")) return route.fulfill({ body: await readFile("public/pdfjs/web/viewer-explanation-import.js"), contentType: "text/javascript" })
    return route.fulfill({ body: '<!doctype html><html><body style="margin:0"><iframe sandbox="allow-scripts" style="display:block;border:0;width:100vw;height:100vh"></iframe></body></html>', contentType: "text/html" })
  })
  try {
    await page.goto("https://import.test/")
    const source = await readFile("tests/fixtures/avl-import.html", "utf8")
    const html = await page.evaluate(async source => {
      const modulePath = "/viewer-explanation-import.js"
      const module = await import(/* webpackIgnore: true */ modulePath)
      return module.preparePdfExplanationHtml(source)
    }, source)
    assert.ok(html.includes("data-pdf-imported-tailwind"))
    assert.ok(html.includes("data-pdf-slide-deck"))
    assert.ok(!html.includes('src="https://cdn.tailwindcss.com"'))
    assert.ok(!html.includes('href="https://fonts.googleapis.com'))
    await page.context().setOffline(true)
    await page.evaluate(html => {
      document.querySelector('iframe')!.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'">` + html
    }, html)
    const frame = page.frameLocator("iframe")
    await frame.locator('#step-title').waitFor()
    await frame.locator('#next-btn').click()
    await frame.locator('#next-btn').click()
    assert.equal(await frame.locator('#concept-svg').isVisible(), false)
    assert.equal(await frame.locator('#rotation-svg').isVisible(), true)
    for (const [width, height] of [[923,564],[390,667],[1280,480]]) {
      await page.setViewportSize({ width, height })
      await frame.locator('#next-btn').click()
      const bounds = await frame.locator('body').evaluate(() => {
        const footer = document.querySelector('footer')!.getBoundingClientRect()
        const main = document.querySelector('main')!.getBoundingClientRect()
        const svg = document.getElementById('rotation-svg')!.getBoundingClientRect()
        const bodyStyle = getComputedStyle(document.body)
        const availableWidth = innerWidth - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight)
        return { fitsWidth: document.documentElement.scrollWidth <= innerWidth,
          fillsWidth: Math.abs(main.width - availableWidth) <= 1,
          fitsHeight: document.documentElement.scrollHeight <= innerHeight,
          footerVisible: footer.bottom <= innerHeight && footer.top >= 0,
          svgFits: svg.top >= main.top && svg.bottom <= main.bottom + 1 && svg.right <= main.right + 1 }
      })
      assert.deepEqual(bounds, { fitsWidth: true, fillsWidth: true, fitsHeight: true, footerVisible: true, svgFits: true }, `${width}x${height}`)
    }
    await frame.locator('#next-btn').click()
    assert.ok((await frame.locator('#step-title').textContent())?.includes('7/8'))
    assert.deepEqual(errors, [])
    assert.deepEqual(violations, [])
  } finally { await browser.close() }
})
