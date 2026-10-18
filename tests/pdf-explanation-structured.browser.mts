import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "@playwright/test"
import { structuredLessonHtml } from "../lib/server/pdf-explanation-renderer.ts"
import { structuredFixture } from "./helpers/explanation-lesson-fixture.mts"

test("offline export navigates AVL states, graphs, SQL tables and embedded math", async () => {
  const browser = await chromium.launch({ headless: true })
  const directory = await mkdtemp(join(tmpdir(), "verlo-structured-"))
  const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 390, height: 800 } })
  const errors: string[] = [], requests: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  const html = structuredLessonHtml(structuredFixture)
  try {
    await writeFile(join(directory, "lesson.html"), html)
    await page.context().setOffline(true)
    await page.goto(pathToFileURL(join(directory, "lesson.html")).href)
    await page.getByRole("heading", { name: "Balanceo del ABB", exact: true }).waitFor()
    assert.equal(await page.locator(".warning").count(), 1)
    assert.equal(await page.getByRole("button", { name: "Anterior", exact: true }).isDisabled(), true)
    const position = async (id: string) => page.locator(`[data-node-id="${id}"]`).getAttribute("transform")
    const initialA = await position("A"), initialD = await position("D")
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()
    assert.notEqual(await position("A"), initialA)
    assert.notEqual(await position("D"), initialD)
    assert.equal(await page.locator('[data-edge-id="ac"]').getAttribute("class"), "diagram-edge active")
    await page.locator('[data-node-id="C"]').focus()
    await page.keyboard.press("Enter")
    assert.equal(await page.locator('[data-node-id="C"]').getAttribute("aria-pressed"), "true")
    await page.getByRole("button", { name: "Repetir", exact: true }).click()
    assert.equal(await page.locator('[data-node-id="C"]').getAttribute("aria-pressed"), "false")
    assert.equal(await page.locator("#counter").textContent(), "Paso 2 de 5")
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()
    assert.equal(await position("A"), initialA)
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()
    assert.equal(await page.locator(".diagram-edge").count(), 2)
    assert.ok(await page.locator(".diagram-edge").first().getAttribute("marker-end"))
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()
    assert.equal(await page.locator("td.active").textContent(), "8")
    assert.equal(await page.locator(".katex").count(), 1)
    assert.equal(await page.getByRole("button", { name: "Siguiente", exact: true }).isDisabled(), true)
    await page.evaluate(() => document.fonts.ready)
    assert.deepEqual(requests, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.reload()
    await page.getByRole("heading", { name: "Balanceo del ABB", exact: true }).waitFor()
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }) }
})

test("fixed SVG runtime animates rotations and replays without executing model text", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const fixture = structuredClone(structuredFixture)
  fixture.title = '</script><script>window.injected=true</script>'
  fixture.steps[0].blocks.unshift({ type: "text", text: '<img src=x onerror="window.injected=true">' })
  try {
    await page.setContent(structuredLessonHtml(fixture))
    await page.getByRole("heading", { name: fixture.title, exact: true }).waitFor()
    const before = await page.locator('[data-node-id="A"]').getAttribute("transform")
    await page.getByRole("button", { name: "Siguiente", exact: true }).click()
    await page.waitForFunction(before => document.querySelector('[data-node-id="A"]')?.getAttribute("transform") !== before, before)
    await page.getByRole("button", { name: "Repetir", exact: true }).click()
    await page.waitForFunction(() => document.getElementById("counter")?.textContent === "Paso 2 de 5")
    assert.equal(await page.evaluate(() => "injected" in window), false)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
