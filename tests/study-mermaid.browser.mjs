import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium, expect } from '@playwright/test'

test('Mermaid SELECT mindmap previews, preserves labels/config, inserts full PNG plus root and reopens for editing', { timeout: 120000 }, async t => {
  const source = await readFile('tests/fixtures/select-mermaid-mindmap.txt', 'utf8')
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {createRoot} from 'react-dom/client';
    import {StudyDiagramsDialog} from './components/study-diagrams-dialog';
    const root=createRoot(document.getElementById('root'));
    window.show=initialSource=>root.render(<StudyDiagramsDialog key={initialSource===undefined?'new':'edit'} initialSource={initialSource} editing={!!initialSource}
      onClose={()=>window.closedDialog=true} onInsert={async(file,source,rootFile)=>{
        window.inserted={source,full:Array.from(new Uint8Array(await file.arrayBuffer())),root:Array.from(new Uint8Array(await rootFile.arrayBuffer()))};
      }}/>);window.show();
  `, loader: 'tsx' }, bundle: true, format: 'esm', write: false, jsx: 'automatic', loader: { '.css': 'empty' } })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('http://mermaid.test/**', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ contentType: path === '/' ? 'text/html' : 'text/javascript', body: path === '/' ? '<div id="root"></div><script type="module" src="/fixture.js"></script>' : bundle.outputFiles[0].text })
  })
  await page.addInitScript(() => {
    window.serializedMaps = []
    const original = XMLSerializer.prototype.serializeToString
    XMLSerializer.prototype.serializeToString = function (node) {
      if (node.localName === 'svg') window.serializedMaps.push(node.outerHTML)
      return original.call(this, node)
    }
  })
  await page.goto('http://mermaid.test/')
  await page.addStyleTag({ path: 'components/study-diagrams.css' })
  await page.getByRole('button', { name: /Mermaid Mindmap/ }).click()
  const code = page.getByRole('textbox', { name: 'Código Mermaid' })
  await code.fill('flowchart LR\nA-->B')
  await expect(page.getByRole('alert')).toContainText('mindmap')
  await code.fill(source)
  const insert = page.getByRole('button', { name: 'Insertar', exact: true })
  await expect.poll(async () => {
    if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').textContent())
    return insert.isEnabled()
  }, { timeout: 60000 }).toBe(true)
  const preview = page.getByRole('img', { name: 'Vista previa de Mermaid Mindmap' })
  await expect.poll(() => preview.evaluate(el => el.naturalWidth)).toBeGreaterThan(100)
  const svg = await page.evaluate(() => window.serializedMaps.at(-1))
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/select-mermaid.svg', svg)
  const labels = await page.evaluate(svg => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    return [...doc.querySelectorAll('g.node')].map(node => [...node.querySelectorAll('.text-outer-tspan')].map(row => row.textContent).join(' ').replace(/\s+/g, ' ').trim())
  }, svg)
  for (const label of ['U4: SELECT', ...source.split('\n').slice(3).filter(line => line.trim()).map(line => line.trim().replace(/<br\s*\/?\s*>/g, ' '))]) assert.ok(labels.includes(label), label)
  assert.ok(!svg.includes('foreignObject'), 'export labels must be SVG text, not removed HTML')
  assert.match(svg, /14px/)
  await page.getByRole('button', { name: 'Maximizar vista previa' }).click()
  await expect(code).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(code).toBeVisible()
  await insert.click()
  await page.waitForFunction(() => !!window.inserted)
  const result = await page.evaluate(async () => {
    const size = async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })); const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return size }
    return { source: window.inserted.source, full: await size(window.inserted.full), root: await size(window.inserted.root), bytes: window.inserted.full }
  })
  assert.equal(result.source, source)
  assert.ok(result.full.width * result.full.height > result.root.width * result.root.height * 2)
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/select-mermaid-mindmap.png', Buffer.from(result.bytes))
  // Re-mount the edit dialog: source type is recognized without changing persisted board metadata.
  await page.evaluate(source => { window.show(undefined); window.show(source) }, source)
  await expect(page.getByRole('dialog', { name: 'Mermaid Mindmap', exact: true })).toBeVisible()
  await expect(code).toHaveValue(source)
})
