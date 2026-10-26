import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

test('home boards migrate on read, recover from the folder with an empty browser, and never restore a stale browser copy', { timeout: 60000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import * as library from './pizarraproyecto-main/src/biblioteca';
    import {deviceDB,writeDeviceBoard,emptyContent} from './pizarraproyecto-main/src/storage/device';
    import {createWorkspaceBoardStore} from './pizarraproyecto-main/src/storage/workspaceBoards';
    window.library=library;window.deviceDB=deviceDB;window.writeDeviceBoard=writeDeviceBoard;window.emptyContent=emptyContent;
    window.createStore=createWorkspaceBoardStore;
    library.setStorageSession(null,false);
    window.connect=async()=>{
      const root=await navigator.storage.getDirectory();
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('local-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({id:'root-handle',handle:root});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
      return root;
    };
  ` }, bundle: true, write: false, format: 'esm' })
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' })
  t.after(() => browser.close())
  const page = await browser.newPage({ serviceWorkers: 'block' }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const directory = resolve('public/pizarra')
  await page.route('https://workspace.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<script type="module" src="/fixture.js"></script>' })
    if (!path.startsWith('/pizarra/') || path.startsWith('/pizarra/api/')) return route.fulfill({ status: 503, body: '{}' })
    const file = resolve(directory, '.' + (path === '/pizarra/' ? '/index.html' : path.slice('/pizarra'.length)))
    assert.ok(file.startsWith(directory + sep))
    try { return route.fulfill({ body: await readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream' }) }
    catch { return route.fulfill({ status: 404 }) }
  })
  const open = async () => { await page.goto('https://workspace.test/'); await page.waitForFunction(() => window.library) }
  await open()
  const migrated = await page.evaluate(async () => {
    const db = await window.deviceDB
    await db.put('meta', true, 'legacy-migrated')
    await window.connect()
    const folder = await window.library.addFolder('Facultad')
    const scene = { ...window.emptyContent(), texts: [{ id: 'text', text: 'Desde el navegador', x: 10, y: 20, fontSize: 24, color: '#000' }],
      media: [{ id: 'photo', assetId: 'photo', kind: 'image', name: 'Original.png', x: 100, y: 100, width: 100, height: 100 }] }
    const photo = new Blob(['original image bytes'], { type: 'image/png' })
    await db.put('assets', photo, 'device:photo')
    for (const id of ['local:legacy-test', 'local:not-opened']) await window.writeDeviceBoard({ id, key: id, name: id, folder_id: folder.id, version: 0, updated_at: '', storage: 'private', content: scene })
    window.library.selectBoard('local:legacy-test')
    const root = await navigator.storage.getDirectory(), store = window.createStore(root)
    const before = await store.library()
    const loaded = await window.library.loadBoard()
    const doc = await store.read('local:legacy-test')
    return { before: before.boards.length, scene: loaded, doc, index: await store.index(), retained: !!await db.get('boards', 'local:legacy-test'), unopened: !!await store.read('local:not-opened') }
  })
  assert.equal(migrated.before, 0, 'listing never bulk migrates browser scenes')
  assert.equal(migrated.doc.scene.texts[0].text, 'Desde el navegador')
  assert.equal(migrated.index.boards.length, 1)
  assert.equal(migrated.retained, true)
  assert.equal(migrated.unopened, false)
  assert.equal(migrated.index.folders[0].name, 'Facultad')

  await page.evaluate(async () => {
    const scene = await window.library.loadBoard()
    scene.texts[0].text = 'Edición guardada en carpeta'
    await window.library.saveBoard(scene)
    const db = await window.deviceDB
    for (const name of ['boards', 'assets', 'meta', 'folders', 'history']) await db.clear(name)
    localStorage.clear()
  })
  await open()
  const recovered = await page.evaluate(async () => {
    const list = await window.library.getLibrary()
    window.library.selectBoard('local:legacy-test')
    const scene = await window.library.loadBoard(), blob = await window.library.loadAsset('photo')
    return { list, scene, asset: await blob.text(), mime: blob.type }
  })
  assert.equal(recovered.list.boards.length, 1)
  assert.equal(recovered.list.boards[0].workspace, true)
  assert.equal(recovered.scene.texts[0].text, 'Edición guardada en carpeta')
  assert.equal(recovered.asset, 'original image bytes')
  assert.equal(recovered.mime, 'image/png')

  // A stale IndexedDB scene cannot overwrite the primary folder document.
  await page.evaluate(async () => {
    const db = await window.deviceDB, board = await db.get('boards', 'local:legacy-test')
    board.content.texts[0].text = 'Copia vieja del navegador'
    await db.put('boards', board)
  })
  await open()
  assert.equal(await page.evaluate(async () => { window.library.selectBoard('local:legacy-test'); return (await window.library.loadBoard()).texts[0].text }), 'Edición guardada en carpeta')
  const metadata = await page.evaluate(async () => {
    const folder = await window.library.addFolder('Nueva carpeta')
    await window.library.renameBoard('local:legacy-test', 'Renombrada', folder.id)
    const first = await window.library.getLibrary()
    await window.library.removeFolder(folder.id)
    const second = await window.library.getLibrary()
    // Drop folder access while retaining the browser replica.
    const db = await new Promise(resolve => { const r = indexedDB.open('local-workspace', 1); r.onsuccess = () => resolve(r.result) })
    await new Promise(resolve => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').delete('root-handle'); tx.oncomplete = resolve }); db.close()
    let error = ''
    try { await window.library.loadBoard() } catch (cause) { error = cause.message }
    return { first, second, error }
  })
  assert.equal(metadata.first.boards[0].name, 'Renombrada')
  assert.ok(metadata.first.boards[0].folder_id)
  assert.equal(metadata.second.boards[0].folder_id, null)
  assert.match(metadata.error, /Conectá la carpeta original/)
  await page.evaluate(() => window.connect())
  const deleted = await page.evaluate(async () => {
    const db = await window.deviceDB, stale = await db.get('boards', 'local:legacy-test')
    await window.library.removeBoard('local:legacy-test')
    await db.put('boards', stale)
    return (await window.library.getLibrary()).boards
  })
  assert.equal(deleted.length, 0, 'a different browser replica cannot resurrect a deleted board')
  // Open the actual app with only the folder content available, then edit it.
  const uiBoard = await page.evaluate(async () => {
    const board = await window.library.addBoard('Pizarra desde carpeta', null)
    window.library.selectBoard(board.id)
    const scene = await window.library.loadBoard()
    scene.texts.push({ id: 'ui-text', text: 'Recuperada de carpeta', x: 100, y: 300, fontSize: 24, color: '#000' })
    await window.library.saveBoard(scene)
    const db = await window.deviceDB
    for (const name of ['boards', 'assets', 'meta', 'folders', 'history']) await db.clear(name)
    localStorage.setItem('pizarra-modo-local-preferido', '1')
    localStorage.setItem('pizarra_activa', board.id)
    return board.id
  })
  await page.goto('https://workspace.test/pizarra/')
  await expect(page.locator('.app')).toHaveAttribute('data-board-id', uiBoard)
  await page.getByTitle('Mis pizarras', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Conectar carpeta de Estudio', exact: true })).toBeVisible()
  await expect(page.locator('.device-board-label').filter({ hasText: 'Carpeta de Estudio' })).toHaveCount(1)
  await page.locator('.library-panel header button[title="Cerrar"]').click()
  await page.locator('.app > canvas').first().evaluate(node => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Editada desde la app')
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  await expect.poll(() => page.evaluate(async id => {
    const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('boards')
    const index = JSON.parse(await (await (await dir.getFileHandle('library.json')).getFile()).text())
    const path = index.boards.find(board => board.id === id).path.slice(7)
    const doc = JSON.parse(await (await (await dir.getFileHandle(path)).getFile()).text())
    return doc.scene.texts.map(text => text.text)
  }, uiBoard)).toEqual(['Recuperada de carpeta', 'Editada desde la app'])
  // A migrated board must offer reconnection instead of displaying stale data.
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('local-workspace', 1); r.onsuccess = () => resolve(r.result) })
    await new Promise(resolve => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').delete('root-handle'); tx.oncomplete = resolve }); db.close()
  })
  await page.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory() })
  await page.reload()
  await expect(page.locator('.library-error')).toContainText('Conectá la carpeta original')
  await expect(page.getByRole('button', { name: 'Conectar carpeta de Estudio', exact: true })).toBeVisible()
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Conectar carpeta de Estudio', exact: true }).click()])
  await expect(page.locator('.app')).toHaveAttribute('data-board-id', uiBoard)
  await expect(page.locator('.library-error')).toHaveCount(0)
  assert.deepEqual(errors, [])
})
