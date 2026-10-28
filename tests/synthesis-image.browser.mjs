import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import { readFile } from "node:fs/promises"
import katex from "katex"

async function setup() {
  const bundle = await build({ entryPoints: ["lib/client/synthesis-image.ts"], bundle: true, write: false, platform: "browser", format: "iife", globalName: "synthesisImage" })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return { browser, page }
}

test("downloads only the selected partial text and complete KaTeX formula as PNG", async () => {
  const { browser, page } = await setup()
  try {
    await page.route("https://katex.test/fonts/**", async route => {
      const name = new URL(route.request().url()).pathname.split("/").at(-1)
      await route.fulfill({ body: await readFile(`node_modules/katex/dist/fonts/${name}`), contentType: "font/woff2", headers: { "Access-Control-Allow-Origin": "*" } })
    })
    await page.setContent(`<base href="https://katex.test/"><style>body{background:white}.tiptap{width:460px;padding:16px;font:22px/1.5 Arial}.outside{color:red;height:200px}.chosen{color:blue}.selection{background:rgb(100,120,255)}</style>
      <button id="download">PNG</button><div class="simple-editor-wrapper"><div class="tiptap" contenteditable="true">
      <p class="outside">DO NOT EXPORT THIS</p><ul><li class="chosen"><strong id="start">DROP<span class="selection">KEEP</span></strong>
      <span data-synthesis-math>${katex.renderToString(String.raw`\sqrt{\frac{x+1}{2}}`)}</span></li></ul>
      <p class="outside">DO NOT EXPORT THIS EITHER</p></div></div>`)
    await page.addStyleTag({ path: "node_modules/katex/dist/katex.min.css" })
    const before = await page.evaluate(() => {
      const source = document.querySelector(".tiptap"), range = document.createRange()
      range.setStart(document.querySelector("#start").firstChild, 4)
      // Stop inside the mathematical source; export must keep the entire atom.
      range.setEnd(source.querySelector("annotation").firstChild, 1)
      getSelection().removeAllRanges(); getSelection().addRange(range)
      const button = document.querySelector("#download")
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => { window.pngExport = synthesisImage.exportSynthesisEditorImage() }
      HTMLAnchorElement.prototype.click = function () { window.pngDownload = { name: this.download, blob: fetch(this.href).then(response => response.blob()) } }
      return { html: source.outerHTML, selection: getSelection().toString(), height: source.offsetHeight }
    })
    await page.click("#download")
    const result = await page.evaluate(async () => {
      await window.pngExport
      const blob = await window.pngDownload.blob, image = new Image(), url = URL.createObjectURL(blob)
      try {
        image.src = url; await image.decode()
        const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        let red = 0, blue = 0, selected = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 180 && data[i + 1] < 80 && data[i + 2] < 80) red++
          if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] > 180) blue++
          if (data[i] === 100 && data[i + 1] === 120 && data[i + 2] === 255) selected++
        }
        return { type: blob.type, name: window.pngDownload.name, height: image.naturalHeight, red, blue, selected,
          html: document.querySelector(".tiptap").outerHTML, selection: getSelection().toString(), copies: document.querySelectorAll(".tiptap").length }
      } finally { URL.revokeObjectURL(url) }
    })
    assert.equal(result.type, "image/png"); assert.equal(result.name, "sintesis-seleccion.png")
    assert.equal(result.red, 0); assert.ok(result.blue > 100); assert.equal(result.selected, 0)
    assert.ok(result.height < before.height * 2)
    assert.equal(result.html, before.html); assert.equal(result.selection, before.selection); assert.equal(result.copies, 1)
  } finally { await browser.close() }
})

test("without selection exports the complete image; cancellation removes temporary copies", async () => {
  const { browser, page } = await setup()
  try {
    await page.setContent(`<div class="simple-editor-wrapper"><div class="tiptap" style="width:400px;font:20px Arial"><p>First paragraph</p><div style="height:2200px"></div><p>Last paragraph</p></div></div>`)
    const result = await page.evaluate(async () => {
      const source = document.querySelector(".tiptap"), original = source.outerHTML
      const blob = await synthesisImage.buildSynthesisEditorImage(source)
      const bitmap = await createImageBitmap(blob), height = bitmap.height
      bitmap.close()
      const range = document.createRange(); range.selectNodeContents(source)
      const controller = new AbortController()
      let cancelled
      try {
        await synthesisImage.buildSynthesisEditorImage(source, { selection: range, signal: controller.signal, onProgress: () => controller.abort() })
      } catch (error) { cancelled = error.name }
      return { type: blob.type, height, expectedHeight: source.offsetHeight * 2, cancelled, unchanged: source.outerHTML === original, copies: document.querySelectorAll(".tiptap").length }
    })
    assert.equal(result.type, "image/png"); assert.equal(result.height, result.expectedHeight)
    assert.equal(result.cancelled, "AbortError"); assert.equal(result.unchanged, true); assert.equal(result.copies, 1)
  } finally { await browser.close() }
})
