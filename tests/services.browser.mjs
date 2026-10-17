import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { normalizeInscreenUserConfig, openInscreenUserConfig, sealInscreenUserConfig, getInscreenConfigSeedFingerprint } from '../lib/inscreen-user-config.ts'
import { servicesStatus } from '../lib/services-config.ts'
import { sealDriveUserConfig } from '../lib/drive-user-config.ts'

process.env.INSCREEN_CONFIG_SEED = 'browser-test-seed-with-more-than-thirty-two-characters'
const providerData = await readFile('lib/local-workspace-data.ts', 'utf8')
const functions = [...providerData.matchAll(/export (?:async )?function (\w+)/g)].map(match => match[1])
const stubData = functions.map(name => `export async function ${name}() { return ${name.includes('Summary') || name.includes('SyncQueue') ? '{synced:0,pending:0,failed:0,errors:[],revision:0,lastPublishedAt:""}' : '[]'}; }`).join('\n')
const assets = Promise.all([
  build({ stdin: { contents: `import React, { useEffect, useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { LocalWorkspaceProvider } from './components/local-workspace-provider';
    function Wheel(){ const [note,setNote]=useState(''); useEffect(()=>{window.wheelMounts=(window.wheelMounts||0)+1},[]);
      return <label>Apunte<input id="note" aria-label="Apunte" value={note} onChange={e=>setNote(e.target.value)}/></label>; }
    createRoot(document.getElementById('root')).render(<LocalWorkspaceProvider enabled><Wheel/></LocalWorkspaceProvider>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'services-fixtures', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'pathname', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const usePathname = () => window.location.pathname;' }))
      builder.onLoad({ filter: /local-workspace-data\.ts$/ }, () => ({ loader: 'ts', contents: stubData }))
      builder.onLoad({ filter: /synthesis-persistence\.ts$/ }, () => ({ loader: 'ts', contents: 'export async function getSynthesisFolderStore(){return {}}' }))
    } }],
  }),
  readFile('app/globals.css', 'utf8').then(css => postcss([tailwind()]).process(css, { from: 'app/globals.css' })),
])
const sealingRoute = build({ entryPoints: ['app/api/inscreen/config/seal/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'provider-fixtures', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(authz|r2|groq-models)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('authz') ? 'export async function requireAuthSession(){return {response:null}}' : args.path.endsWith('r2') ? 'export async function deleteR2Object(){} export async function uploadR2Object(){} export async function downloadR2Object(){return {buffer:Buffer.from("User.Services R2 verification")}}' : 'export async function listGroqGenerationModels(){return []}' }))
  } }],
}).then(result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`))

async function setup(t, initialFiles = {}) {
  const [bundle, css] = await assets
  const { POST } = await sealingRoute
  const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.addInitScript(initialFiles => {
    window.fixtureFiles = new Map(Object.entries(JSON.parse(sessionStorage.getItem('service-fixture-files') || JSON.stringify(initialFiles))))
    const directories = new Set([''])
    const missing = () => new DOMException('No existe', 'NotFoundError')
    const save = () => sessionStorage.setItem('service-fixture-files', JSON.stringify(Object.fromEntries(window.fixtureFiles)))
    const directory = (prefix = '') => ({
      name: 'Cursado', kind: 'directory', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      getDirectoryHandle: async (name, options = {}) => {
        const path = prefix + name + '/'
        if (!options.create && !directories.has(path)) throw missing()
        directories.add(path); return directory(path)
      },
      getFileHandle: async (name, options = {}) => {
        const path = prefix + name
        if (!options.create && !window.fixtureFiles.has(path)) throw missing()
        return { name, kind: 'file', getFile: async () => {
          if (!window.fixtureFiles.has(path)) throw missing()
          return new File([window.fixtureFiles.get(path)], name)
        }, createWritable: async () => {
          let content
          return { write: async value => { content = value }, close: async () => {
            if (window.failWrites && path === 'User.Services') throw new DOMException('Sin espacio', 'QuotaExceededError')
            window.fixtureFiles.set(path, typeof content === 'string' ? content : await new Blob([content]).text()); save()
          }, abort: async () => {} }
        } }
      },
      removeEntry: async name => { if (!window.fixtureFiles.delete(prefix + name)) throw missing(); save() },
      async *entries() {},
    })
    window.fixtureRoot = directory()
    window.showDirectoryPicker = async () => window.fixtureRoot
    const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.put = function(value, ...rest) {
      return put.call(this, this.name === 'workspace' && value?.id === 'root-handle' ? { id: value.id, fixtureHandle: true } : value, ...rest)
    }
    IDBObjectStore.prototype.get = function(key) {
      const request = get.call(this, key)
      if (this.name === 'workspace' && key === 'root-handle') {
        const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result')
        Object.defineProperty(request, 'result', { get() { const value = descriptor.get.call(request); return value?.fixtureHandle ? { id: key, handle: window.fixtureRoot } : value } })
      }
      return request
    }
  }, initialFiles)
  await page.route('https://services.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/inscreen/config/seal') {
      const response = await POST(new Request(route.request().url(), { method: 'POST', headers: route.request().headers(), body: route.request().postData() }))
      return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
    }
    if (path === '/api/inscreen/config/status') {
      try {
        const token = route.request().headers()['x-inscreen-config-token'] || ''
        const config = openInscreenUserConfig(token)
        return route.fulfill({ json: { configured: true, seedFingerprint: getInscreenConfigSeedFingerprint(), services: servicesStatus(config) } })
      } catch { return route.fulfill({ json: { configured: false, error: 'No se pudo desbloquear User.Services con la semilla de este despliegue.' } }) }
    }
    if (path === '/api/pdf-explanation') return route.fulfill({ status:428, json:{ error:'No se pudo desbloquear User.Services con la semilla de este despliegue.' } })
    if (path.startsWith('/api/')) return route.fulfill({ json: { configured: false, connected: false } })
    return route.fulfill({ contentType: 'text/html', body: `<style>${css.css} body {font-family:Arial,sans-serif} *,*::before,*::after {animation:none!important;transition:none!important}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>` })
  })
  await page.goto('https://services.test/estudio')
  await page.getByRole('button', { name: 'Seleccionar carpeta', exact: true }).click()
  await page.getByRole('textbox', { name: 'Apunte' }).waitFor()
  return page
}

test('pipe shortcut opens a compact editor without unmounting the wheel and saves every requested credential encrypted', async t => {
  const page = await setup(t)
  await page.getByRole('textbox', { name: 'Apunte' }).fill('Borrador')
  await page.keyboard.press('|')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => document.activeElement.blur())
  await page.keyboard.press('1')
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.keyboard.press('|')
  await page.getByRole('dialog', { name: 'Servicios', exact: true }).waitFor()
  await page.getByRole('button', { name: /Respaldo en Azure/ }).click()
  const connection = `DefaultEndpointsProtocol=https;AccountName=cursadotest;AccountKey=${Buffer.alloc(32, 1).toString('base64')};EndpointSuffix=core.windows.net`
  await page.getByLabel('Cadena de conexión', { exact: true }).fill(connection)
  await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('azureGpt')
  await page.getByLabel('Clave de Azure', { exact: true }).fill('azure-browser-secret')
  await page.getByLabel('Endpoint del recurso o proyecto', { exact: true }).fill('https://test.openai.azure.com')
  await page.getByLabel('Nombre del despliegue (opcional)', { exact: true }).fill('study-mini')
  await page.getByRole('combobox').selectOption('gateway')
  await page.getByLabel('Clave de AI Gateway', { exact: true }).fill('gateway-browser-secret')
  await page.getByRole('combobox').selectOption('datalab')
  await page.getByLabel('Clave de Datalab', { exact: true }).fill('datalab-browser-secret')
  await page.getByRole('combobox').selectOption('cloudflareVoice')
  await page.getByLabel('Token de Cloudflare', { exact: true }).fill('cloudflare-browser-secret')
  await page.getByLabel('Identificador de cuenta', { exact: true }).fill('a'.repeat(32))
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/services-editor-desktop.png' })
  await page.setViewportSize({ width: 375, height: 812 })
  const mobileDialog = await page.getByRole('dialog').boundingBox()
  assert.ok(mobileDialog.x >= 0 && mobileDialog.x + mobileDialog.width <= 375)
  await page.screenshot({ path: 'test-results/services-editor-mobile.png' })
  await page.setViewportSize({ width: 900, height: 700 })
  await page.getByRole('button', { name: 'Guardar cifrado', exact: true }).click()
  await page.getByRole('dialog', { name: 'Servicios', exact: true }).waitFor()
  const contents = await page.evaluate(() => window.fixtureFiles.get('User.Services'))
  assert.doesNotMatch(contents, /azure-browser-secret|gateway-browser-secret|datalab-browser-secret|cloudflare-browser-secret|DefaultEndpointsProtocol/)
  const config = openInscreenUserConfig(JSON.parse(contents).inscreenToken)
  assert.equal(config.storage_azure, connection)
  assert.equal(config.AZURE_OPENAI_DEPLOYMENT, 'study-mini')
  assert.equal(config.datalab, 'datalab-browser-secret')
  assert.equal(config.cloudflareapi, 'cloudflare-browser-secret')
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  assert.doesNotMatch(storage, /azure-browser-secret|gateway-browser-secret|datalab-browser-secret|cloudflare-browser-secret/)
  assert.equal(await page.evaluate(() => window.wheelMounts), 1)
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/services-panel.png' })
  await page.getByRole('button', { name: 'Cerrar', exact: true }).first().click()
  assert.equal(await page.getByRole('textbox', { name: 'Apunte' }).inputValue(), 'Borrador|')
  await page.reload()
  await page.getByRole('textbox', { name: 'Apunte' }).waitFor()
  await page.keyboard.press('|')
  await page.getByRole('dialog', { name: 'Servicios', exact: true }).waitFor()
  assert.equal(await page.getByText('Configurado', { exact: true }).count(), 5)
})

test('updating a service preserves legacy Groq, Marker, R2 and Drive; a failed file write keeps the old credentials and allows retry', async t => {
  const legacy = normalizeInscreenUserConfig({ GROQ_API_KEY: 'legacy-groq', MARKER_API: 'legacy-marker', R2_BUCKET_NAME: 'bucket', R2_ACCESS_KEY_ID: 'access', R2_SECRET_ACCESS_KEY: 'secret', R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, gatewayia: 'original-gateway' })
  const drive = sealDriveUserConfig({ refreshToken: 'legacy-drive', rootFolderId: 'folder', rootFolderName: 'Cursado', rootFolderLink: 'https://drive.google.com/drive/folders/folder', email: 'test@example.com' })
  const initial = JSON.stringify({ version: 1, inscreenToken: sealInscreenUserConfig(legacy), driveToken: drive, seedFingerprint: getInscreenConfigSeedFingerprint(), savedAt: new Date().toISOString(), validatedAt: new Date().toISOString() })
  const page = await setup(t, { 'User.Services': initial })
  await page.keyboard.press('|')
  await page.getByRole('button', { name: /AI Gateway/ }).click()
  await page.getByLabel('Clave de AI Gateway', { exact: true }).fill('replacement-gateway')
  await page.evaluate(() => { window.failWrites = true })
  await page.getByRole('button', { name: 'Guardar cifrado', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.deepEqual(JSON.parse(await page.evaluate(() => window.fixtureFiles.get('User.Services'))), JSON.parse(initial))
  await page.evaluate(() => { window.failWrites = false })
  await page.getByRole('button', { name: 'Guardar cifrado', exact: true }).click()
  await page.getByRole('dialog', { name: 'Servicios', exact: true }).waitFor()
  const saved = JSON.parse(await page.evaluate(() => window.fixtureFiles.get('User.Services')))
  assert.equal(saved.driveToken, drive)
  assert.deepEqual(openInscreenUserConfig(saved.inscreenToken), { ...legacy, gatewayia: 'replacement-gateway' })
  assert.deepEqual(JSON.parse(await page.evaluate(() => window.fixtureFiles.get('User.Services.backup'))), JSON.parse(initial))
})


test('API card defaults to Azure, offers Groq and saves a new encrypted configuration with a backup', async t => {
  const initial = JSON.stringify({ version: 1, inscreenToken: 'v1.old.tag.ciphertext', driveToken: 'old-drive', seedFingerprint: 'old', savedAt: new Date().toISOString(), validatedAt: new Date().toISOString() })
  const page = await setup(t, { 'User.Services': initial })
  await page.evaluate(() => window.dispatchEvent(new Event('cursado-services-recovery-required')))
  const card = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Cargamos tu API/ }) })
  await card.waitFor()
  assert.equal(await card.getByLabel('Proveedor').inputValue(), 'azure')
  await card.getByLabel('Proveedor').selectOption('groq')
  assert.equal(await card.getByLabel('Endpoint de Azure').count(), 0)
  await card.getByLabel('Proveedor').selectOption('azure')
  await card.getByLabel('API key', { exact: true }).fill('azure-new-secret')
  await card.getByLabel('Endpoint de Azure').fill('https://example.openai.azure.com')
  await card.getByLabel('Modelo (nombre del despliegue)').fill('my-gpt-5-mini')
  await card.getByRole('button', { name: 'Guardar', exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  const saved = JSON.parse(await page.evaluate(() => window.fixtureFiles.get('User.Services')))
  const config = openInscreenUserConfig(saved.inscreenToken)
  assert.equal(config.gpt5mini, 'azure-new-secret')
  assert.equal(config.conexiongpt5mini, 'https://example.openai.azure.com')
  assert.equal(config.AZURE_OPENAI_DEPLOYMENT, 'my-gpt-5-mini')
  assert.equal(config.GROQ_API_KEY, '')
  assert.equal(saved.driveToken, '')
  assert.equal(await page.evaluate(() => window.fixtureFiles.get('User.Services.backup')), JSON.stringify(JSON.parse(initial), null, 2))
})


test('entering with incompatible credentials stays quiet; using the star opens the API card on failure', async t => {
  const initial = JSON.stringify({ version: 1, inscreenToken: 'v1.old.tag.ciphertext', driveToken: '', seedFingerprint: 'old', savedAt: new Date().toISOString(), validatedAt: new Date().toISOString() })
  const page = await setup(t, { 'User.Services': initial })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => fetch('/api/inscreen/config/status', {headers:{'x-inscreen-config-token':'v1.old.tag.ciphertext'}}))
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => fetch('/api/pdf-explanation', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'Explicar',transcription:'Texto'})}))
  await page.getByRole('heading', { name: /Cargamos tu API/ }).waitFor()
  await page.getByRole('button', {name:'Ahora no',exact:true}).click()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => fetch('/api/inscreen/config/status'))
  assert.equal(await page.getByRole('dialog').count(), 0)
})
