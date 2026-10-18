import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium } from "@playwright/test"
import { structuredLessonHtml } from "../lib/server/pdf-explanation-renderer.ts"
import { graphFixture, gridGraphFixture } from "./helpers/explanation-graphs-fixture.mts"
import { generalGraphFixture } from './helpers/explanation-general-graphs-fixture.mts'
import { avlTeachingFixture } from './helpers/explanation-avl-teaching-fixture.mts'

test('light graph player fits the viewport, zooms at the pointer with Ctrl+wheel and resets after panning', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setContent(structuredLessonHtml(avlTeachingFixture))
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(241, 245, 249)')
    for (const [width, height] of [[1366,768],[1280,480],[390,667],[390,400]]) {
      await page.setViewportSize({ width, height })
      await page.getByRole('button', { name: 'Ajustar gráfico al espacio', exact: true }).click()
      for (const step of [1,4,8]) {
        await page.getByRole('button', { name: `Ir al paso ${step}`, exact: true }).click()
        assert.equal(await page.evaluate(() => {
          const stage = document.querySelector<HTMLElement>('#stage')!, box = stage.getBoundingClientRect()
          const fits = [...document.querySelectorAll('.node .shape')].every(node => {
            const n = node.getBoundingClientRect()
            return n.left >= box.left && n.right <= box.right && n.top >= box.top && n.bottom <= box.bottom
          })
          const nav = document.querySelector('nav')!.getBoundingClientRect()
          return fits && box.height > 0 && stage.scrollWidth === stage.clientWidth && stage.scrollHeight === stage.clientHeight &&
            nav.top >= 0 && nav.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight
        }), true, `${width}x${height}, step ${step}`)
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('button', { name: 'Ajustar gráfico al espacio', exact: true }).click()
    const stage = (await page.locator('#stage').boundingBox())!, point = { x: stage.x + stage.width * .4, y: stage.y + stage.height * .6 }
    const worldPoint = () => page.evaluate(point => {
      const p = new DOMPoint(point.x,point.y).matrixTransform(document.querySelector<SVGSVGElement>('#scene')!.getScreenCTM()!.inverse())
      return { x: p.x, y: p.y }
    }, point)
    const before = await worldPoint()
    await page.mouse.move(point.x,point.y)
    await page.keyboard.down('Control'); await page.mouse.wheel(0,-300); await page.keyboard.up('Control')
    await page.waitForFunction(() => Number(document.body.dataset.graphZoom) > 1)
    const after = await worldPoint()
    assert.ok(Math.hypot(before.x-after.x,before.y-after.y) < .001, 'the point under the pointer stays fixed during zoom')
    assert.equal(await page.evaluate(() => visualViewport!.scale), 1, 'Ctrl+wheel changes the graph rather than browser zoom')
    const originalView = await page.locator('#scene').getAttribute('viewBox')
    await page.mouse.move(stage.x+20,stage.y+20); await page.mouse.down(); await page.mouse.move(stage.x+90,stage.y+60,{steps:5}); await page.mouse.up()
    assert.notEqual(await page.locator('#scene').getAttribute('viewBox'), originalView)
    await page.getByRole('button', { name: 'Ajustar gráfico al espacio', exact: true }).click()
    assert.equal(await page.locator('body').getAttribute('data-graph-zoom'), '1')
    await page.screenshot({ path: 'test-results/graph-light-fit.png', fullPage: true })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test('teaching sequence explains each change beside its anchor and preserves the subtree order', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' })
  try {
    await page.setContent(structuredLessonHtml(avlTeachingFixture))
    for (let i = 0; i < 8; i++) {
      await page.getByRole('button', { name: `Ir al paso ${i+1}`, exact: true }).click()
      assert.equal(await page.locator('#step-title').textContent(), avlTeachingFixture.diapositivas[i].titulo)
      assert.equal(await page.locator('#step-objective').textContent(), avlTeachingFixture.diapositivas[i].objetivo)
      assert.equal(await page.locator('.callout').count(), 1)
      assert.equal(await page.locator('.comment-leader').count(), await page.locator('#stage .callout').count())
      if (i === 5) {
        assert.equal(await page.locator('[data-edge-id="A:C"]').isVisible(), false)
        assert.equal(await page.locator('[data-edge-id="D:C"]').isVisible(), true)
        await page.screenshot({ path: 'test-results/avl-teaching-desktop.png', fullPage: true })
      }
    }
    await page.setViewportSize({ width: 390, height: 800 })
    await page.waitForFunction(() => document.querySelectorAll('#notes .callout').length === 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => document.querySelector('nav')!.getBoundingClientRect().top >= document.querySelector('#notes')!.getBoundingClientRect().bottom), true, 'controls do not cover the explanation on mobile')
    await page.screenshot({ path: 'test-results/avl-teaching-mobile.png', fullPage: true })
  } finally { await browser.close() }
})

test('general graph cards support different topics, complete labels, per-step values, cycles and mobile offline', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  try {
    await page.context().setOffline(true)
    for (const topic of ['process', 'network', 'dependencies'] as const) {
      await page.setViewportSize({ width: 1366, height: 768 })
      const fixture = generalGraphFixture(topic)
      if (topic === 'dependencies') {
        fixture.elementos_iniciales[0].etiqueta = 'Etiqueta larga sin recortar: ' + 'abcdefghij'.repeat(9)
        fixture.elementos_iniciales[0].datos![0].valor = '<script>window.injected=true</script>' + '1234567890'.repeat(8)
      }
      await page.setContent(structuredLessonHtml(fixture))
      assert.equal(await page.locator('body').getAttribute('data-graph-engine'), 'd3')
      const a = page.locator('[data-node-id="A"]'), b = page.locator('[data-node-id="B"]')
      const original = await b.elementHandle()
      assert.equal(await a.locator('.node-title').allTextContents().then(lines => lines.join('')), fixture.elementos_iniciales[0].etiqueta)
      assert.equal(await a.locator('.datum-value').allTextContents().then(lines => lines.join('')).then(text => text.includes(fixture.elementos_iniciales[0].datos![0].valor)), true)
      assert.equal(await page.locator('[data-edge-id="A:B"]').getAttribute('marker-end'), 'url(#graph-arrow)')
      assert.ok((await page.locator('[data-edge-id="A:B"]').getAttribute('d'))!.includes(' Q '))
      assert.ok((await page.locator('[data-edge-id="B:A"]').getAttribute('d'))!.includes(' Q '))
      assert.ok((await page.locator('[data-edge-id="B:B"]').getAttribute('d'))!.includes(' C '))
      assert.equal(await page.locator('.callout').count(), 1)
      assert.equal(await page.locator('.comment-leader').count(), await page.locator('#stage .callout').count(), 'anchored comments keep their leaders; others stay in the explanation panel')
      for (const [width, height] of [[1366,768],[1280,480],[390,667]]) {
        await page.setViewportSize({ width, height })
        for (let step = 1; step <= 3; step++) {
          await page.getByRole('button', { name: `Ir al paso ${step}`, exact: true }).click()
          assert.equal(await page.evaluate(() => {
            const svg = document.querySelector<SVGSVGElement>('#scene')!.viewBox.baseVal
            const shapes = [...document.querySelectorAll<SVGGraphicsElement>('.node .shape')].map(el => el.getBoundingClientRect())
            const noOverlap = shapes.every((a,i) => shapes.every((b,j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top))
            const nodesFit = [...document.querySelectorAll<SVGGElement>('.node')].every(node => {
              const shape = node.querySelector<SVGGraphicsElement>('.shape')!.getBBox(), text = node.querySelector<SVGGraphicsElement>('.node-content')!.getBBox()
              const p = node.transform.baseVal.consolidate()!.matrix
              return text.x >= shape.x && text.x + text.width <= shape.x + shape.width + 1 && text.y >= shape.y && text.y + text.height <= shape.y + shape.height + 1 &&
                p.e + shape.x >= svg.x && p.e + shape.x + shape.width <= svg.x + svg.width && p.f + shape.y >= svg.y && p.f + shape.y + shape.height <= svg.y + svg.height
            })
            const stage = document.querySelector('#stage')!.getBoundingClientRect()
            const commentsFit = [...document.querySelectorAll('#stage .callout')].every(el => {
              const box = el.getBoundingClientRect()
              return box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && box.bottom <= stage.bottom
            })
            return noOverlap && nodesFit && commentsFit && document.documentElement.scrollWidth <= innerWidth
          }), true, `${topic} ${width}x${height} step ${step}`)
          if (step === 2) assert.ok((await b.textContent())!.includes('completado'))
          if (step === 3) { assert.equal(await b.locator('.datum-value').count(), 0); assert.equal(await a.locator('.datum-value').count() > 0, true) }
        }
      }
      assert.equal(await b.evaluate((node, old) => node === old, original), true)
      assert.equal(await page.evaluate(() => 'injected' in window), false)
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, [])
  } finally { await browser.close() }
})

test('card transitions attach edges to measured boundaries and fade topology changes together', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  try {
    await page.setContent(structuredLessonHtml(generalGraphFixture()))
    await page.locator('#next').click()
    await page.waitForFunction(() => {
      const opacity = Number((document.querySelector('[data-edge-id="B:C"]') as SVGElement).style.opacity)
      return opacity > .05 && opacity < .95
    })
    assert.equal(await page.evaluate(() => {
      const edge = document.querySelector<SVGPathElement>('[data-edge-id="B:C"]')!
      const node = document.querySelector<SVGGElement>('[data-node-id="B"]')!, p = node.transform.baseVal.consolidate()!.matrix
      const box = node.querySelector<SVGGraphicsElement>('.shape')!.getBBox(), point = edge.getPointAtLength(0)
      const onBoundary = Math.min(Math.abs(Math.abs(point.x-p.e)-box.width/2-2), Math.abs(Math.abs(point.y-p.f)-box.height/2-2)) < .1
      const oldOpacity = Number((document.querySelector('[data-edge-id="A:B"]') as SVGElement).style.opacity)
      return onBoundary && oldOpacity > 0 && oldOpacity < 1
    }), true)
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight')
    await page.locator('#replay').click()
    await page.locator('body[data-animating="false"]').waitFor()
    assert.equal(await page.locator('[data-edge-id="A:B"]').isVisible(), false)
    assert.equal(await page.locator('[data-edge-id="B:C"]').isVisible(), true)
    assert.ok((await page.locator('[data-node-id="B"]').textContent())!.includes('completado'))
    await page.screenshot({ path: 'test-results/general-graph-process.png', fullPage: true })
  } finally { await browser.close() }
})

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
    assert.equal(await page.locator('body').getAttribute('data-graph-engine'), 'd3')
    const a = page.locator('[data-node-id="A"]')
    const original = await a.elementHandle()
    assert.equal(await a.getAttribute("transform"), "translate(380 220)")
    assert.equal(await page.locator(".subtree").count(), 3)
    assert.equal(await page.locator(".callout").count(), 1)
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
    assert.ok(await page.locator('.motion-guide').count() > 0)
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
    assert.equal(await page.locator('.motion-guide').count(), 0)
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
