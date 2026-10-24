import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

test('pinned PDF stays at the viewport edge while reading and returns to the split position on close', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    await page.setContent(`<div class="app" data-library-split="true" data-pdf-reader="false"><div class="math-dock"><button>Herramienta</button><div class="math-dock-pdfs"><button aria-label="Abrir PDF fijado">PDF</button></div></div></div>`)
    await page.addStyleTag({ content: await readFile('pizarraproyecto-main/src/RightMathDock.css', 'utf8') })
    const position = () => page.locator('.math-dock').evaluate(el => ({ right: getComputedStyle(el).right, zIndex: getComputedStyle(el).zIndex }))
    assert.equal((await position()).right, '697px')
    await page.locator('.app').evaluate(el => { el.dataset.pdfReader = 'true' })
    assert.equal((await position()).right, '14px')
    assert.equal((await position()).zIndex, '10001')
    await page.setViewportSize({ width: 1000, height: 768 })
    assert.equal((await position()).right, '14px')
    await page.locator('.app').evaluate(el => { el.dataset.pdfReader = 'false' })
    assert.equal((await position()).right, '514px')
    await page.locator('.app').evaluate(el => { el.dataset.librarySplit = 'false' })
    assert.equal((await position()).right, '14px')
    await page.setViewportSize({ width: 600, height: 800 })
    await page.locator('.app').evaluate(el => { el.dataset.librarySplit = 'true'; el.dataset.pdfReader = 'true' })
    assert.equal((await position()).right, '7px')
  } finally { await browser.close() }
})
