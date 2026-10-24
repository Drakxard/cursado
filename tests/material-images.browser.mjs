import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import path from "node:path"
import { expect } from "@playwright/test"

test("image conversion preserves dimensions, ordering, transparency and continues after invalid files", async () => {
  const bundle = await build({ entryPoints: ["lib/client/images-to-pdf.ts"], bundle: true, write: false, format: "iife", globalName: "Images", platform: "browser" })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto("about:blank")
    await page.addScriptTag({ path: path.resolve("public/vendor/pdf-lib.min.js") })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(async () => {
      async function image(name, type, width, height) {
        const canvas = document.createElement("canvas")
        canvas.width = width; canvas.height = height
        const context = canvas.getContext("2d")
        context.fillStyle = "red"; context.fillRect(0, 0, width / 2, height)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, type))
        return new File([blob], name, { type })
      }
      const files = await Promise.all([image("foto10.jpg", "image/jpeg", 120, 80), image("foto2.png", "image/png", 40, 90), image("foto3.webp", "image/webp", 70, 50)])
      const sorted = Images.sortMaterialImages(files)
      const broken = new File(["invalid"], "rota.png", { type: "image/png" })
      const converted = await Images.createPdfFromImages([...sorted, broken], "Apuntes")
      const pdf = await PDFLib.PDFDocument.load(await converted.file.arrayBuffer())
      const single = await Images.createPdfFromImages([files[0]], "foto10")
      const invalid = await Images.createPdfFromImages([broken], "rota")
      // Add an EXIF orientation=6 segment without modifying the original JPEG data.
      const jpeg = new Uint8Array(await files[0].arrayBuffer())
      const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0])
      const rotated = new File([jpeg.slice(0,2), exif, jpeg.slice(2)], "rotada.jpg", { type: "image/jpeg" })
      const rotatedResult = await Images.createPdfFromImages([rotated], "rotada")
      const rotatedPdf = await PDFLib.PDFDocument.load(await rotatedResult.file.arrayBuffer())
      return {
        names: sorted.map(file => file.name), name: converted.file.name, mime: converted.file.type,
        sizes: pdf.getPages().map(page => [page.getWidth(), page.getHeight()]),
        errors: converted.errors, single: single.file.name, invalid: invalid.file,
        rotated: [rotatedPdf.getPage(0).getWidth(), rotatedPdf.getPage(0).getHeight()],
      }
    })
    assert.deepEqual(result.names, ["foto2.png", "foto3.webp", "foto10.jpg"])
    assert.deepEqual(result.sizes, [[40, 90], [70, 50], [120, 80]])
    assert.equal(result.name, "Apuntes.pdf")
    assert.equal(result.mime, "application/pdf")
    assert.equal(result.single, "foto10.pdf")
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /rota.png/)
    assert.equal(result.invalid, null)
    assert.deepEqual(result.rotated, [80, 120])
  } finally { await browser.close() }
})

test("multiple-image dialog offers separate PDFs and editable combined page order", async () => {
  const bundle = await build({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { useMaterialImagesDialog } from './components/material-images-dialog';
    function App() {
      const {choose, dialog} = useMaterialImagesDialog();
      window.chooseImages = async () => { window.choice = undefined; const value = await choose(['foto10.png', 'foto2.png', 'foto1.png'].map(name => new File(['x'], name))); window.choice = value ? {names: value.files.map(f=>f.name), combined:value.combined, name:value.name} : null; };
      return dialog;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", tsconfig: "tsconfig.json" })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.waitForFunction(() => !!window.chooseImages)
    await page.evaluate(() => { void window.chooseImages() })
    await expect(page.getByRole('button', {name:'Un PDF por imagen', exact:true})).toHaveAttribute('aria-pressed','true')
    await page.getByRole('button', {name:'Unir en PDF', exact:true}).click()
    await expect(page.getByRole('textbox', {name:'Nombre del PDF'})).toHaveValue('Apuntes')
    await page.getByRole('textbox', {name:'Nombre del PDF'}).fill('Mis apuntes')
    await page.getByRole('button', {name:'Bajar foto1.png', exact:true}).click()
    await page.getByText('foto10.png', {exact:true}).locator('..').dragTo(page.getByText('foto2.png', {exact:true}).locator('..'))
    await page.getByRole('button', {name:'Subir', exact:true}).click()
    await page.waitForFunction(() => window.choice !== undefined)
    assert.deepEqual(await page.evaluate(() => window.choice), {names:['foto10.png','foto2.png','foto1.png'],combined:true,name:'Mis apuntes'})
    await page.evaluate(() => { void window.chooseImages() })
    await page.getByRole('button', {name:'Subir', exact:true}).click()
    await page.waitForFunction(() => window.choice !== undefined)
    assert.equal(await page.evaluate(() => window.choice.combined),false)
    await page.evaluate(() => { void window.chooseImages() })
    await page.getByRole('button', {name:'Cancelar', exact:true}).click()
    await page.waitForFunction(() => window.choice === null)
  } finally { await browser.close() }
})
