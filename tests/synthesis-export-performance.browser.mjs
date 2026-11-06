import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("exports the complete translation lesson with the real math editor", async t => {
  const lesson = await readFile("tests/fixtures/synthesis-translation.txt", "utf8")
  const bundle = await build({
    stdin: { contents: `
      import { Editor } from '@tiptap/core';
      import StarterKit from '@tiptap/starter-kit';
      import { SynthesisMath } from './components/synthesis/math-extension';
      import { normalizeSynthesisMath } from './lib/synthesis-math';
      export { buildSynthesisEditorExportSvg } from './lib/client/synthesis-image';
      export function openLesson(text) {
        return new Editor({element: document.querySelector('#editor'), extensions: [StarterKit, SynthesisMath],
          content: normalizeSynthesisMath({type:'doc', content: text.split(/\\r?\\n/).filter(line => line.trim()).map(text => ({type:'paragraph',content:[{type:'text',text}]}))})});
      }
    `, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "lessonExport",
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 768 } })
    await page.route("https://katex.test/fonts/**", async route => {
      const name = new URL(route.request().url()).pathname.split("/").at(-1)
      await route.fulfill({ body: await readFile(`node_modules/katex/dist/fonts/${name}`), contentType: "font/woff2", headers: { "Access-Control-Allow-Origin": "*" } })
    })
    await page.setContent('<!doctype html><base href="https://katex.test/"><style>body{margin:0;background:white}.tiptap{box-sizing:border-box;width:794px;padding:24px;font:22px/1.6 Arial;color:#111}p{margin:16px 0}</style><div id="editor"></div>')
    await page.addStyleTag({ path: "node_modules/katex/dist/katex.min.css" })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(async lesson => {
      lessonExport.openLesson(lesson)
      await document.fonts.ready
      const source = document.querySelector(".tiptap"), before = source.outerHTML
      let styleReads = 0
      const computed = window.getComputedStyle
      window.getComputedStyle = (...args) => { styleReads++; return computed(...args) }
      const start = performance.now()
      try {
        const blob = await lessonExport.buildSynthesisEditorExportSvg(source, { selection: null })
        const text = await blob.text()
        const svg = new DOMParser().parseFromString(text, "image/svg+xml")
        const images = Array.from(svg.querySelectorAll("image"))
        const tiles = []
        for (const node of images) {
          const image = new Image()
          image.src = node.getAttribute("href")
          await image.decode()
          tiles.push({ width: Number(node.getAttribute("width")), height: Number(node.getAttribute("height")), pixels: image.naturalWidth * image.naturalHeight,
            pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight, y: Number(node.getAttribute("y")) })
          image.removeAttribute("src")
        }
        return { ms: performance.now() - start, size: blob.size, styleReads,
          formulas: source.querySelectorAll(".katex").length, elements: source.querySelectorAll("*").length,
          width: Number(svg.documentElement.getAttribute("width")), height: Number(svg.documentElement.getAttribute("height")), expectedWidth: source.scrollWidth,
          expectedHeight: source.scrollHeight, unchanged: source.outerHTML === before, tiles,
          pureImages: !svg.querySelector("foreignObject, text, script") && images.every(node => node.getAttribute("href").startsWith("data:image/png")) }
      } finally { window.getComputedStyle = computed }
    }, lesson)
    t.diagnostic(JSON.stringify(result))
    assert.ok(result.formulas > 100)
    assert.ok(result.size > 10000)
    assert.equal(result.width, result.expectedWidth)
    assert.equal(result.height, result.expectedHeight)
    assert.equal(result.unchanged, true)
    assert.equal(result.pureImages, true)
    assert.ok(result.styleReads < result.elements, "math glyphs must not require individual computed-style copies")
    assert.ok(result.tiles.every(tile => tile.pixelWidth === tile.width * 2 && tile.pixelHeight === tile.height * 2 && tile.pixels <= 4 * 1024 * 1024))
    assert.ok(result.tiles.every((tile, i) => tile.y === (i ? result.tiles[i - 1].y + result.tiles[i - 1].height : 0)))
  } finally { await browser.close() }
})
