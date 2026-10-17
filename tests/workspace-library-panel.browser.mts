import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'

test('saved R2 stays hidden and is reused; missing R2 has an illustrated guide; recovery errors never ask for new keys', async () => {
  const workspace = `export function getReadyInscreenConfigToken(){return window.__token||''} export function setReadyInscreenConfigToken(token){window.__token=token} export function setReadyWorkspaceHandle(){} export async function loadWorkspaceHandle(){return {name:'Mis materias'}} export async function loadServicesFile(){return window.__services||null} export async function loadInscreenFileHalf(){return null} export async function persistServicesFile(root,value){window.__services=value;return value} export async function queryWorkspacePermission(){return 'granted'} export async function requestWorkspacePermission(){return 'granted'} export async function pickWorkspaceRootHandle(){return {name:'Otra carpeta'}}`
  const publisher = `export async function libraryRoot(){return {name:'Mis materias'}} export async function readLibraryState(){return null} export async function publishLibrary(){window.__publishes=(window.__publishes||0)+1;return {workspaceId:'workspace-panel-test-12345',publishedAt:new Date().toISOString()}} export async function libraryOwnerApi(action){if(action==='devices')return {devices:[]};if(action==='pairing/create')return {pairingUri:'inscreen://workspace-pair?token=fixture',expiresAt:Date.now()+300000};throw Error(action)}`
  const fixtures: Record<string, string> = { '@/lib/local-workspace-client': workspace, '@/lib/client/workspace-library': publisher }
  const bundle = await build({ stdin: { contents: `import {createRoot} from 'react-dom/client';import {createElement} from 'react';import {WorkspaceLibraryButton} from './components/workspace-library';createRoot(document.getElementById('root')).render(createElement(WorkspaceLibraryButton))`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', format: 'iife', plugins: [{ name: 'panel-folder', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in fixtures ? { path: args.path, namespace: 'fixture' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'js' }))
  } }] })
  const css = (await readFile('app/globals.css', 'utf8')).split('@font-face')[0].replace(/^@import.*$/gm, '')
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  try {
    for (const scenario of ['workspace', 'deployment', 'none', 'damaged']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
      let sealCalls = 0
      await page.addInitScript((scenario) => {
        const fixture = window as unknown as { __services?: { inscreenToken: string }; __copied?: string }
        if (scenario === 'workspace' || scenario === 'damaged') fixture.__services = { inscreenToken: scenario === 'damaged' ? 'damaged' : 'already-saved' }
        Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text: string) { fixture.__copied = text } } })
      }, scenario)
      await page.route('**/*', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/panel.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); return }
        if (pathname === '/api/inscreen/workspace/config') {
          if (scenario === 'workspace') assert.equal(route.request().headers()['x-inscreen-config-token'], 'already-saved')
          await route.fulfill({ status: scenario === 'damaged' ? 400 : 200, contentType: 'application/json', body: JSON.stringify(scenario === 'damaged' ? { ok: false, error: 'No se pudo abrir User.Services. Recuperá tu configuración.' } : { ok: true, configured: scenario !== 'none', source: scenario }) }); return
        }
        if (pathname === '/api/inscreen/config/seal') { sealCalls++; await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }); return }
        await route.fulfill({ contentType: 'text/html', body: `<html><head><style>${css}</style></head><body><div id="root"></div><script src="/panel.js"></script></body></html>` })
      })
      await page.goto('https://cursado.test')
      await page.getByRole('button', { name: 'Sincronizar dispositivos' }).click()
      if (scenario === 'workspace' || scenario === 'deployment') {
        await page.getByText('✓ R2 conectado', { exact: true }).waitFor()
        assert.equal(await page.locator('input').count(), 0)
        await page.getByRole('button', { name: 'Comenzar a subir' }).click()
        await page.getByRole('img', { name: 'QR para vincular InScreen' }).waitFor()
        assert.equal(sealCalls, 0)
        assert.equal(await page.evaluate(() => (window as unknown as { __publishes: number }).__publishes), 1)
      } else if (scenario === 'none') {
        await page.getByLabel('Endpoint S3', { exact: true }).waitFor()
        assert.equal(await page.getByLabel('Endpoint S3', { exact: true }).getAttribute('type'), 'url')
        await page.getByRole('button', { name: 'Cómo conseguir y configurar R2' }).click()
        await page.getByRole('heading', { name: /Paso 1 de 4/ }).waitFor()
        await page.getByRole('img', { name: 'Ilustración: Elegí tu bucket' }).waitFor()
        await page.getByRole('button', { name: 'Siguiente' }).click()
        await page.getByRole('heading', { name: /Paso 2 de 4/ }).waitFor()
        await page.getByRole('button', { name: 'Siguiente' }).click()
        await page.getByRole('heading', { name: /Paso 3 de 4/ }).waitFor()
        await mkdir('.cache', { recursive: true }); await page.screenshot({ path: '.cache/r2-setup-guide.png' })
        await page.getByRole('button', { name: 'Siguiente' }).click()
        await page.getByRole('button', { name: 'Copiar JSON' }).click()
        await page.getByRole('button', { name: 'Copiado', exact: true }).waitFor()
        const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied)
        assert.deepEqual(JSON.parse(copied)[0].AllowedOrigins, ['https://cursado.test'])
        await page.setViewportSize({ width: 390, height: 844 })
        assert.equal(await page.locator('.r2-guide').evaluate(element => element.scrollWidth <= element.clientWidth), true)
        await page.screenshot({ path: '.cache/r2-setup-guide-mobile.png' })
        await page.keyboard.press('Escape')
        assert.equal(await page.getByRole('heading', { name: 'Sincronizá tus dispositivos' }).isVisible(), true)
      } else {
        await page.getByRole('alert').filter({ hasText: 'Recuperá tu configuración' }).waitFor()
        assert.equal(await page.locator('input').count(), 0)
        assert.equal(await page.getByRole('button', { name: 'Comenzar a subir' }).isDisabled(), true)
      }
      await page.close()
    }
  } finally { await browser.close() }
})
