import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "@playwright/test"
import { structuredLessonHtml } from "../lib/server/pdf-explanation-renderer.ts"
import { graphFixture, gridGraphFixture } from "./helpers/explanation-graphs-fixture.mts"

test("graph export navigates offline, keeps node identity, anchors comments and handles mobile", async () => {
  const browser = await chromium.launch({ headless: true })
  const directory = await mkdtemp(join(tmpdir(), "verlo-graphs-"))
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" })
  const errors: string[] = [], requests: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  const fixture = structuredClone(graphFixture)
  fixture.diapositivas[0].comentarios[0].texto = '<img src=x onerror="window.injected=true">'
  try {
    const path = join(directory, "lesson.html")
    await writeFile(path, structuredLessonHtml(fixture))
    await page.context().setOffline(true)
    await page.goto(pathToFileURL(path).href)
    const a = page.locator('[data-node-id="A"]')
    const original = await a.elementHandle()
    assert.equal(await a.getAttribute("transform"), "translate(380 220)")
    assert.equal(await page.locator(".subtree").count(), 3)
    assert.equal(await page.locator("#stage .callout").count(), 1)
    const commentPosition = await page.locator(".callout").evaluate(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }))
    assert.ok(commentPosition.x > 0 && commentPosition.y > 0)
    await page.keyboard.press("ArrowRight")
    assert.equal(await a.getAttribute("transform"), "translate(500 120)")
    assert.equal(await a.evaluate((el, original) => el === original, original), true)
    assert.equal(await page.locator('[data-edge-id="A:C"]').isVisible(), false)
    assert.equal(await page.locator('[data-edge-id="D:C"]').isVisible(), true)
    assert.equal(await page.locator('[data-node-id="C"]').getAttribute("data-state"), "destacado")
    await page.getByRole("button", { name: "Repetir", exact: true }).click()
    assert.equal(await a.getAttribute("transform"), "translate(500 120)")
    await page.getByRole("button", { name: "Ir al paso 1", exact: true }).click()
    assert.equal(await a.getAttribute("transform"), "translate(380 220)")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowLeft")
    await page.setViewportSize({ width: 390, height: 800 })
    await page.waitForFunction(() => document.querySelectorAll('#notes .callout').length === 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => "injected" in window), false)
    assert.equal(await page.locator("#notes").textContent(), 'D: <img src=x onerror="window.injected=true">')
    await page.reload()
    await page.getByRole("heading", { name: fixture.titulo }).waitFor()
    assert.deepEqual(requests, [])
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }) }
})

test("graph transitions keep edge endpoints attached and cancel stale animations", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  try {
    await page.setContent(structuredLessonHtml(gridGraphFixture))
    await page.keyboard.press("ArrowRight")
    await page.waitForFunction(() => document.querySelector('[data-node-id="A"]')?.getAttribute('transform') !== 'translate(250 206)')
    const geometry = await page.evaluate(() => {
      const node = document.querySelector<SVGGElement>('[data-node-id="A"]')!
      const p = node.transform.baseVal.consolidate()!.matrix
      const edge = document.querySelector<SVGPathElement>('[data-edge-id="A:D"]')!
      const start = edge.getPointAtLength(0)
      return Math.hypot(start.x - p.e, start.y - p.f)
    })
    assert.ok(Math.abs(geometry - 30) < .1)
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("ArrowRight")
    await page.getByRole("button", { name: "Repetir", exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-node-id="A"]')?.getAttribute('transform') === 'translate(450 50)')
    assert.equal(await page.locator('#counter').textContent(), "Paso 2 de 2")
    await page.keyboard.press("ArrowLeft")
    await page.waitForFunction(() => document.querySelector('[data-node-id="A"]')?.getAttribute('transform') === 'translate(250 206)')
    assert.equal(await page.locator('[data-edge-id="D:C"]').isVisible(), false)
  } finally { await browser.close() }
})

test("relative comments are placed by the player, stay in bounds and fall back on mobile", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" })
  try {
    await page.setContent(structuredLessonHtml(gridGraphFixture))
    assert.equal(await page.locator('#stage .callout').count(), 1)
    const geometry = await page.evaluate(() => {
      const n = document.querySelector('[data-node-id="D"] .shape')!.getBoundingClientRect()
      const c = document.querySelector('.callout')!.getBoundingClientRect()
      const s = document.getElementById('stage')!.getBoundingClientRect()
      return { right: c.left > n.right, inside: c.left >= s.left && c.right <= s.right && c.top >= s.top && c.bottom <= s.bottom }
    })
    assert.deepEqual(geometry, { right: true, inside: true })
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.locator('[data-node-id="A"]').getAttribute('transform'), 'translate(450 50)')
    await page.setViewportSize({ width: 390, height: 800 })
    await page.waitForFunction(() => document.querySelectorAll('#notes .callout').length === 2)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  } finally { await browser.close() }
})
