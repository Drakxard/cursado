import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

test('home frame tracking ignores PDF updates and releases removed and navigated documents', async t => {
  const bundle = await build({ stdin: { contents: `
    import {observeHomeFrames} from './lib/client/home-frame-observer';
    window.activeDocuments=new Set();window.attaches=0;window.detaches=0;window.scans=0;
    const query=Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll=function(selector){if(selector==='iframe')window.scans++;return query.call(this,selector)};
    window.stopTracking=observeHomeFrames(window,current=>{
      const doc=current.document;window.activeDocuments.add(doc);window.attaches++;
      return ()=>{window.activeDocuments.delete(doc);window.detaches++};
    });
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife' })
  const browser = await chromium.launch({headless:true,channel:process.env.CI?undefined:'chrome'})
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto('about:blank')
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  assert.equal(await page.evaluate(() => activeDocuments.size),1)
  const scans = await page.evaluate(() => scans)
  await page.evaluate(async () => {
    const host=document.createElement('div');document.body.append(host)
    for(let i=0;i<30;i++) { host.textContent='PDF page '+i;await new Promise(resolve=>setTimeout(resolve,0)) }
  })
  assert.equal(await page.evaluate(() => window.scans),scans)
  for(let i=0;i<5;i++) {
    await page.evaluate(async () => {
      const frame=document.createElement('iframe');frame.id='reader';frame.srcdoc='<p>PDF</p>'
      const loaded=new Promise(resolve=>frame.onload=resolve);document.body.append(frame);await loaded
    })
    await page.waitForFunction(() => activeDocuments.size===2)
    await page.evaluate(async () => {
      const frame=document.querySelector('#reader')
      const loaded=new Promise(resolve=>frame.onload=resolve);frame.srcdoc='<p>Another PDF</p>';await loaded
    })
    await page.waitForFunction(() => activeDocuments.size===2 && detaches>0)
    await page.evaluate(() => document.querySelector('#reader').remove())
    await page.waitForFunction(() => activeDocuments.size===1)
  }
  await page.evaluate(() => {
    const frame=document.createElement('iframe');document.body.append(frame)
    stopTracking()
  })
  assert.deepEqual(await page.evaluate(() => ({active:activeDocuments.size,balanced:attaches===detaches})),{active:0,balanced:true})
})
