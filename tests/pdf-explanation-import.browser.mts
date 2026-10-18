import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { chromium } from "@playwright/test"

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
