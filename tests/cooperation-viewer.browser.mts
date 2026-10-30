import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

test('PDF cooperation keeps syncing without opening deletion dialogs', async () => {
  const bundled = await build({
    entryPoints: ['lib/client/cooperation-viewer.ts'],
    bundle: true, write: false, platform: 'browser', format: 'iife',
    plugins: [{ name: 'cooperation-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/cooperation\.ts$/ }, () => ({ path: 'cooperation', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const cooperationState=()=>({deletions:[{id:'pending',label:'Práctica',decision:'wait'}]});
        export const startCooperationBackground=()=>{window.syncStarted=true;return ()=>{window.syncStopped=true}};
        export const notifyCooperationDeletion=()=>{throw new Error('Unexpected automatic review')};
        export const decideCooperationDeletion=()=>{throw new Error('Unexpected automatic decision')};
      ` }))
    } }],
  })
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  try {
    const page = await browser.newPage()
    await page.route('https://cooperation.test/**', route => route.fulfill({ contentType: 'text/html', body: '<button onclick="this.textContent=\'Listo\'">Continuar leyendo</button>' }))
    await page.goto('https://cooperation.test/viewer')
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    assert.equal(await page.evaluate(() => (window as any).syncStarted), true)
    await page.evaluate(() => {
      for (let index = 0; index < 3; index++) window.dispatchEvent(new Event('cursado-cooperation-changed'))
    })
    assert.equal(await page.locator('dialog').count(), 0)
    await page.getByRole('button', { name: 'Continuar leyendo' }).click()
    await page.getByRole('button', { name: 'Listo' }).waitFor()
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    assert.equal(await page.evaluate(() => (window as any).syncStopped), true)
  } finally { await browser.close() }
})
