// Run against `next start`, before and after building the change. Uses an isolated OPFS fixture.
import { chromium, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { instrumentResources, resourceSampler } from './browser-resource-metrics.mjs'

const origin = process.env.CURSADO_TEST_URL || 'http://localhost:3007'
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] })
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } })
  await context.addInitScript(instrumentResources)
  const page = await context.newPage()
  await page.route(origin + '/__resource-setup', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  await page.goto(origin + '/__resource-setup')
  await page.evaluate(async () => {
    localStorage.setItem('inscreen.config-skipped.v1', '1')
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('resource-study', { create: true })
    const manifests = await root.getDirectoryHandle('manifests', { create: true })
    const progress = await root.getDirectoryHandle('progreso', { create: true })
    const tasksWriter = await (await progress.getFileHandle('importantes.json', { create: true })).createWritable()
    await tasksWriter.write(JSON.stringify({ version: 1, tasks: [{ id: 'resource-task', text: 'Tarea de prueba', startDate: '2026-10-25', dueDate: '2026-11-01', url: '', topics: ['Pizarra de prueba'], topicBoardIds: ['resource-board'] }] })); await tasksWriter.close()
    const now = new Date().toISOString(), subject = { id: 'resource-subject', name: 'Materia de prueba', storageKey: 'Resource', color: '#2563eb', tabId: 'main', createdAt: now, targetWeekday: 0 }
    for (const [name, value] of Object.entries({ 'subject-catalog.json': { version: 2, subjects: { [subject.id]: { ...subject, normalizedName: 'materia de prueba', updatedAt: now } } }, 'workspace-state.json': { workspaceTabs: {}, activeWorkspaceTabId: 'main', isMainWorkspaceTabVisible: true, subjectWeekdays: {}, customSubjects: { [subject.id]: subject } } })) {
      const writer = await (await manifests.getFileHandle(name, { create: true })).createWritable(); await writer.write(JSON.stringify(value)); await writer.close()
    }
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('local-workspace', 1); q.onupgradeneeded = () => q.result.createObjectStore('workspace', { keyPath: 'id' }); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
    await new Promise((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put({ id: 'root-handle', handle: root }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }); db.close()
  })
  const sample = await resourceSampler(browser, page)
  await page.goto(origin + '/estudio')
  await expect(page.getByRole('button', { name: /Materia de prueba/ })).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1500)
  const results = [await sample('Study initial')]
  await page.waitForTimeout(5000); results.push(await sample('Study idle'))
  // Exercise the real embedded board lifecycle through Importantes.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Agregar', exact: true })).toBeVisible({ timeout: 10000 })
  results.push(await sample('Important tasks opened'))
  await page.getByRole('button', { name: 'Tema Pizarra de prueba. Abrir pizarra. Mantener presionado para borrar', exact: true }).click()
  const board = page.frameLocator('iframe[title*="Tarea de prueba"]')
  await expect(board.locator('.app')).toBeVisible({ timeout: 20000 })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Volver a Temas', exact: true }).click()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: /Materia de prueba/ })).toBeVisible()
  results.push(await sample('Study after board return'))
  const report = { fixture: 'production Study, one synthetic local subject and important task, embedded board, OPFS; 1366x900 DPR 1', note: 'Working set includes browser/GPU.', results,
    javascriptBytes: await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.js(?:\?|$)/.test(entry.name)).reduce((sum, entry) => sum + entry.decodedBodySize, 0)) }
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
