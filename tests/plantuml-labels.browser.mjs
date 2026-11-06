import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createServer } from '../pizarraproyecto-main/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'

test('PlantUML label images contain complete translation formulas and wide equations', async t => {
  const server = await createServer({root:fileURLToPath(new URL('../pizarraproyecto-main',import.meta.url)),server:{host:'127.0.0.1',port:0}})
  await server.listen()
  t.after(()=>server.close())
  const browser = await chromium.launch({headless:true})
  t.after(()=>browser.close())
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pizarra/plantuml.html`)
  const result = await page.evaluate(async()=>{
    const {rasterPlantumlLabels}=await import('/pizarra/src/canvas/plantumlLabel.ts')
    const measurements=[]
    let svg=''
    const serialize=XMLSerializer.prototype.serializeToString
    XMLSerializer.prototype.serializeToString=function(node){
      for(const label of document.querySelectorAll('[data-plantuml-label]')){
        const box=label.getBoundingClientRect()
        const parts=Array.from(label.querySelectorAll('.katex-html, .katex-html *'),part=>part.getBoundingClientRect()).filter(rect=>rect.width&&rect.height)
        measurements.push({width:box.width,height:box.height,left:Math.min(...parts.map(rect=>rect.left-box.left)),right:Math.max(...parts.map(rect=>rect.right-box.left)),top:Math.min(...parts.map(rect=>rect.top-box.top)),bottom:Math.max(...parts.map(rect=>rect.bottom-box.top))})
      }
      svg=serialize.call(this,node)
      return svg
    }
    const labels=await rasterPlantumlLabels([
      String.raw`Multiplicar en tiempo por $e^{at}$ desplaza la frecuencia: $\mathcal{L}\{e^{at}f(t)\}=F(s-a)$`,
      String.raw`Regla de inversión: $\mathcal{L}^{-1}\{F(s-a)\}=e^{at}f(t)$`,
      String.raw`$\sum_{k=0}^{n}\frac{a_k}{s^{k+1}}=\frac{a_0}{s}+\frac{a_1}{s^2}+\frac{a_2}{s^3}+\frac{a_3}{s^4}+\frac{a_4}{s^5}+\frac{a_5}{s^6}+\frac{a_6}{s^7}$`,
    ])
    return {measurements,svg,images:labels.map(label=>({width:label.width,height:label.height,png:label.canvas.toDataURL()}))}
  })
  assert.equal(result.images.length,3)
  await mkdir('test-results',{recursive:true})
  await writeFile('test-results/plantuml-labels.svg',result.svg)
  for(const [index,image] of result.images.entries())await writeFile(`test-results/plantuml-label-${index}.png`,Buffer.from(image.png.split(',')[1],'base64'))
  const fonts=result.svg.match(/@font-face\s*\{[^}]*\}/g)??[]
  assert.ok(fonts.length>0,'KaTeX fonts must be embedded in the rasterized SVG')
  for(const font of fonts)assert.match(font,/src:\s*url\(["']?data:/,'every font weight and style needs its own embedded source')
  for(const box of result.measurements){
    assert.ok(box.left>=-1&&box.right<=box.width+1,`formula exceeds label horizontally: ${JSON.stringify(box)}`)
    assert.ok(box.top>=-1&&box.bottom<=box.height+1,`formula exceeds label vertically: ${JSON.stringify(box)}`)
  }
})
