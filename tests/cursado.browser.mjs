import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

const origin = process.env.CURSADO_TEST_URL || 'http://localhost:3000'
async function browserFor(t) {
  const browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true })
  t.after(() => browser.close())
  return browser
}

test('launcher matches both layouts and opens both modules without a study folder prompt', async t => {
  const browser = await browserFor(t)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(origin)
  await page.getByRole('navigation', { name: 'Elegir aplicación' }).waitFor()
  assert.equal(await page.getByRole('link').count(), 2)
  assert.equal(await page.locator('[role=dialog]').count(), 0)
  for (const img of await page.locator('nav img').all()) assert.equal(await img.evaluate(image => image.complete && image.naturalWidth > 0), true)
  const choices = await page.locator('nav a').all()
  const left = await choices[0].boundingBox(), right = await choices[1].boundingBox()
  assert.ok(left.x < right.x && Math.abs(left.y - right.y) < 2)
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/cursado-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const top = await choices[0].boundingBox(), bottom = await choices[1].boundingBox()
  assert.ok(top.y < bottom.y)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: 'test-results/cursado-mobile.png' })
  await page.getByRole('link', { name: 'Abrir organizador de estudio' }).click()
  await page.waitForURL('**/estudio')
  // Ctrl+Q also works before a folder is selected.
  await page.keyboard.press('Control+q')
  await page.waitForURL(origin + '/')
  await page.route('**/pizarra/api/**', route => route.fulfill({ status: 401, json: { detail: 'Sin sesión' } }))
  await page.getByRole('link', { name: 'Abrir Pizarra' }).click()
  await page.getByRole('heading', { name: 'Tu pizarra' }).waitFor()
  assert.ok(new URL(page.url()).pathname === '/pizarra/')
  await page.getByRole('textbox').first().fill('Usuario')
  await page.keyboard.press('Control+q')
  await page.waitForURL(origin + '/')
})

test('private board flushes a new stroke before Ctrl+Q, restores it, and scopes offline caching', async t => {
  const browser = await browserFor(t)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route('**/pizarra/api/**', route => route.fulfill({ status: 401, json: {} }))
  await page.goto(origin + '/pizarra/')
  await page.getByRole('button', { name: 'Abrir privadas y copias de este dispositivo' }).click()
  await page.locator('canvas').first().waitFor()
  await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.endsWith('/pizarra/sw.js'))
  await page.mouse.move(300, 330)
  await page.mouse.down()
  await page.mouse.move(440, 420, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.press('Control+q')
  await page.waitForURL(origin + '/')
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), false)
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(registration => registration.scope))
  assert.ok(registrations.every(scope => new URL(scope).pathname === '/pizarra/'))
  await page.goto(origin + '/pizarra/')
  await page.locator('canvas').first().waitFor()
  const strokes = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pizarra-dispositivo', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const boards = await new Promise(resolve => { const request = db.transaction('boards').objectStore('boards').getAll(); request.onsuccess = () => resolve(request.result) })
    db.close()
    return boards.reduce((count, board) => count + (board.content?.strokes?.length || 0), 0)
  })
  assert.ok(strokes > 0)
  await context.setOffline(true)
  await page.reload()
  await page.locator('canvas').first().waitFor()
  await context.setOffline(false)
})

test('restores a remembered board profile and sends invitation requests through the board namespace', async t => {
  const browser = await browserFor(t)
  const page = await browser.newPage()
  const requests = []
  await page.route('**/pizarra/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 'remembered', display_name: 'Rafael', color: '#6366f1', is_admin: 0, emoji: '⭐' } })
    if (path.endsWith('/share/join')) return route.fulfill({ status: 400, json: { detail: 'Invitación de prueba' } })
    return route.fulfill({ status: 503, json: { detail: 'Servidor no disponible' } })
  })
  await page.goto(origin + '/pizarra?invite=example')
  await page.locator('canvas').first().waitFor()
  assert.ok(requests.includes('/pizarra/api/auth/me'))
  assert.ok(requests.includes('/pizarra/api/share/join'))
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('pizarra-perfil-copia')))
  assert.equal(profile.id, 'remembered')
  await page.waitForFunction(async () => {
    const id = localStorage.getItem('pizarra_activa')
    if (!id) return false
    const db = await new Promise(resolve => { const request = indexedDB.open('pizarra-dispositivo', 1); request.onsuccess = () => resolve(request.result) })
    const board = await new Promise(resolve => { const request = db.transaction('boards').objectStore('boards').get(id); request.onsuccess = () => resolve(request.result) })
    db.close()
    return Boolean(board?.content?.camera)
  })
  await page.keyboard.press('Control+q')
  await page.waitForURL(origin + '/')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pizarra-perfil-copia')).id), 'remembered')
})

test('home guard waits for saves and embedded viewers, blocks on failure, and permits retry', async t => {
  const browser = await browserFor(t)
  const bundle = await build({
    stdin: { contents: `import { registerHomeSave, returnToHome, trackHomeWrites } from './lib/client/home-navigation';
      trackHomeWrites(window);
      window.returnHome = returnToHome;
      registerHomeSave(async () => { await new Promise(resolve => setTimeout(resolve, 180)); if (window.failSave) throw new Error('Guardado fallido'); localStorage.setItem('saved', 'yes'); });
      addEventListener('cursado-home-error', e => document.getElementById('error').textContent = e.detail);
      addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'q') { e.preventDefault(); returnToHome(); } }, true);`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  })
  const page = await browser.newPage()
  await page.route('https://home.test/**', route => route.fulfill({ contentType: 'text/html', body: '<input id="input"><div id="error"></div><iframe srcdoc="<p>Visor</p>"></iframe>' }))
  await page.goto('https://home.test/estudio')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => {
    window.failSave = true
    document.querySelector('iframe').contentWindow.__cursadoBeforeHome = async () => { localStorage.setItem('viewer-saved', 'yes') }
  })
  await page.locator('input').focus()
  await page.keyboard.press('Control+q')
  await page.waitForFunction(() => document.getElementById('error').textContent === 'Guardado fallido')
  assert.equal(new URL(page.url()).pathname, '/estudio')
  assert.equal(await page.evaluate(() => localStorage.getItem('viewer-saved')), 'yes')
  await page.evaluate(() => { window.failSave = false })
  await page.keyboard.press('Control+q')
  assert.equal(new URL(page.url()).pathname, '/estudio')
  await page.waitForURL('https://home.test/')
  assert.equal(await page.evaluate(() => localStorage.getItem('saved')), 'yes')
})

test('home guard waits for primary writes and does not block a locally saved draft on optional cloud backups', async t => {
  const browser = await browserFor(t)
  const bundle = await build({
    stdin: { contents: `import { returnToHome, trackHomeWrites } from './lib/client/home-navigation';
      trackHomeWrites(window); window.returnHome = returnToHome;
      addEventListener('cursado-home-error', e => document.getElementById('error').textContent=e.detail);`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
  })
  const page = await browser.newPage()
  await page.route('https://writes.test/**', async route => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) {
      await new Promise(resolve => setTimeout(resolve, 180))
      return route.fulfill({ status: 500, json: { error: 'Test failure' } })
    }
    return route.fulfill({ contentType: 'text/html', body: '<div id="error"></div>' })
  })
  await page.goto('https://writes.test/estudio')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => { void fetch('/api/sessions', { method: 'POST' }); void window.returnHome() })
  await page.waitForFunction(() => document.getElementById('error').textContent.includes('guardar'))
  assert.equal(new URL(page.url()).pathname, '/estudio')
  await page.evaluate(() => { void fetch('/api/storage/azure', { method: 'POST' }).catch(() => {}); void window.returnHome() })
  await page.waitForURL('https://writes.test/')
})

test('Ctrl+Q works inside same-origin and sandboxed frames and remains on screen when a save fails', async t => {
  const browser = await browserFor(t)
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import { HomeShortcut } from './components/home-shortcut';
      import { registerHomeSave } from './lib/client/home-navigation';
      registerHomeSave(async () => { if(window.failSave) throw new Error('Guardado fallido'); localStorage.setItem('frame-saved','yes'); });
      createRoot(document.getElementById('root')).render(<HomeShortcut/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'test-pathname', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'pathname', namespace: 'test' }))
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const usePathname = () => "/estudio";' }))
    } }],
  })
  const page = await browser.newPage()
  await page.route('https://frames.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><iframe id="same" srcdoc="<input aria-label=\'Visor\'>"></iframe><iframe id="sandbox" sandbox="allow-scripts"></iframe>' }))
  await page.goto('https://frames.test/estudio')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => {
    window.failSave = true
    document.getElementById('sandbox').srcdoc = `<input aria-label="Explicación"><script>addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='q'){e.preventDefault();parent.postMessage({type:'cursado-return-home'},'*')}})<\/script>`
  })
  await page.frameLocator('#same').getByRole('textbox').focus()
  await page.keyboard.press('Control+q')
  await page.getByRole('alert').waitFor()
  assert.equal(new URL(page.url()).pathname, '/estudio')
  await page.evaluate(() => { window.failSave = false })
  await page.frameLocator('#sandbox').getByRole('textbox').focus()
  await page.keyboard.press('Control+q')
  await page.waitForURL('https://frames.test/')
  assert.equal(await page.evaluate(() => localStorage.getItem('frame-saved')), 'yes')
})

test('shared board keeps the ticket WebSocket flow and finishes a remote save before returning home', async t => {
  const browser = await browserFor(t)
  const page = await browser.newPage()
  const packets = []
  const paths = []
  let savedContent = { strokes: [], texts: [], media: [], shapes: [], tables: [], graphs: [], videos: [], camera: { x: 0, y: 0, zoom: 1 } }
  let version = 1
  await page.routeWebSocket('wss://board.test/live?ticket=example', socket => {
    socket.onMessage(message => packets.push(JSON.parse(String(message))))
    socket.send(JSON.stringify({ type: 'presence', board_id: 'shared', users: [], you: 'client' }))
  })
  await page.route('**/pizarra/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    paths.push(path)
    if (path.endsWith('/auth/me')) return route.fulfill({ headers: { 'Set-Cookie': 'pizarra_sid=example; HttpOnly; SameSite=Lax; Path=/' }, json: { id: 'user', display_name: 'Rafael', color: '#6366f1', is_admin: 0, emoji: '⭐' } })
    if (path.endsWith('/library')) return route.fulfill({ json: { folders: [], boards: [{ id: 'shared', name: 'Compartida', folder_id: null, version, storage: 'shared', role: 'owner', updated_at: new Date().toISOString() }] } })
    if (path.endsWith('/live-ticket')) return route.fulfill({ json: { url: 'wss://board.test/live?ticket=example' } })
    if (path.endsWith('/boards/shared') && route.request().method() === 'PUT') {
      await new Promise(resolve => setTimeout(resolve, 150))
      savedContent = route.request().postDataJSON().content
      version++
      return route.fulfill({ json: { version } })
    }
    if (path.endsWith('/boards/shared')) return route.fulfill({ json: { id: 'shared', name: 'Compartida', content: savedContent, version } })
    return route.fulfill({ json: [] })
  })
  await page.goto(origin + '/pizarra/')
  await page.locator('canvas').first().waitFor()
  await page.waitForFunction(() => localStorage.getItem('pizarra_activa') === 'shared')
  // A ticket request proves the loaded shared board reached its connection effect.
  const deadline = Date.now() + 15000
  while (!paths.includes('/pizarra/api/boards/shared/live-ticket') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(paths.includes('/pizarra/api/boards/shared/live-ticket'))
  await page.mouse.move(310, 310)
  await page.mouse.down()
  await page.mouse.move(450, 390, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Control+q')
  await page.waitForURL(origin + '/')
  assert.ok(savedContent.strokes.length > 0)
  assert.ok(packets.length > 0)
  assert.ok(paths.includes('/pizarra/api/boards/shared/live-ticket'))
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === 'pizarra_sid')
  assert.ok(cookie?.httpOnly)
  assert.equal(cookie?.path, '/')
})

test('a failed private board write prevents leaving and can be retried', async t => {
  const browser = await browserFor(t)
  const page = await browser.newPage()
  await page.route('**/pizarra/api/**', route => route.fulfill({ status: 401, json: {} }))
  await page.goto(origin + '/pizarra/')
  await page.getByRole('button', { name: 'Abrir privadas y copias de este dispositivo' }).click()
  await page.locator('canvas').first().waitFor()
  await page.waitForFunction(() => localStorage.getItem('pizarra_activa')?.startsWith('local:'))
  await page.evaluate(() => {
    window.failBoardWrites = true
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(...args) {
      if (window.failBoardWrites && this.name === 'boards') throw new DOMException('Disco lleno', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.mouse.move(310, 310)
  await page.mouse.down()
  await page.mouse.move(450, 390, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Control+q')
  await page.getByRole('alert').waitFor()
  assert.equal(new URL(page.url()).pathname, '/pizarra/')
  await page.evaluate(() => { window.failBoardWrites = false })
  await page.keyboard.press('Control+q')
  await page.waitForURL(origin + '/')
})
