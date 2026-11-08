import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const origin = process.env.CURSADO_TEST_URL || 'http://localhost:3000'

test('production Study and the material list stay bounded while idle', { timeout: 360_000 }, async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  const errors = [], samples = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    FileSystemHandle.prototype.queryPermission = async () => 'granted'
    FileSystemHandle.prototype.requestPermission = async () => 'granted'
    window.showDirectoryPicker = () => navigator.storage.getDirectory()
  })
  await page.route('**/pizarra/api/**', route => route.fulfill({ status: 401, json: { detail: 'Sin sesión' } }))
  await page.goto(origin)
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const write = async (path, value) => {
      const parts = path.split('/'); let dir = root
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
      const writer = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable()
      await writer.write(JSON.stringify(value)); await writer.close()
    }
    const now = new Date(), date = now.toISOString(), subject = 'custom-numerico'
    const weekday = (now.getDay() + 6) % 7
    const week = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(2026, 2, 23)) / (7 * 86400000)) + 2
    await write('manifests/workspace-state.json', { workspaceTabs: {}, activeWorkspaceTabId: 'main', isMainWorkspaceTabVisible: true,
      subjectWeekdays: { [subject]: weekday }, customSubjects: { [subject]: { id: subject, name: 'Numérico', color: '#0f766e', storageKey: 'numerico', tabId: 'main', createdAt: date, targetWeekday: weekday } } })
    await write('manifests/subject-catalog.json', { version: 2, subjects: { [subject]: { id: subject, name: 'Numérico', normalizedName: 'numerico', storageKey: 'numerico', createdAt: date, updatedAt: date } } })
    await write(`manifests/materials/numerico/week-${week}.json`, { materials: Array.from({ length: 22 }, (_, index) => ({
      id: 100 + index, subject_id: subject, file_name: `Apunte-${index + 1}.pdf`, drive_file_id: `workspace://teoria/numerico/apunte-${index + 1}.pdf`,
      material_type: 'theory', week_number: week, weekday_index: weekday, session_date: date.slice(0, 10), created_at: date, updated_at: date, order_index: index,
    })) })
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('local-workspace', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('workspace', { keyPath: 'id' })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('workspace', 'readwrite')
        tx.objectStore('workspace').put({ id: 'root-handle', handle: root })
        tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
      }
    })
  })
  await page.goto(origin + '/estudio')
  const subject = page.getByRole('button', { name: /Numérico/ }).first()
  await subject.waitFor({ timeout: 30_000 })
  const client = await page.context().newCDPSession(page)
  const browserClient = await browser.newBrowserCDPSession()
  await client.send('Performance.enable')
  const measure = async (screen, elapsed) => {
    const metrics = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
    const dom = await client.send('Memory.getDOMCounters')
    // Tab memory also includes native allocations, decoded resources and code.
    const renderers = (await browserClient.send('SystemInfo.getProcessInfo')).processInfo.filter(process => process.type === 'renderer')
    const rendererRssBytes = process.platform === 'linux' ? (await Promise.all(renderers.map(async process => {
      const status = await readFile(`/proc/${process.id}/status`, 'utf8').catch(() => '')
      return Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024
    }))).reduce((a, b) => a + b, 0) : null
    samples.push({ screen, elapsed, rendererRssBytes, ...metrics, ...dom })
    console.log(JSON.stringify({ screen, elapsed, heapMB: metrics.JSHeapUsedSize / 1048576, rendererRssMB: rendererRssBytes / 1048576, nodes: dom.nodes, listeners: dom.jsEventListeners, taskSeconds: metrics.TaskDuration }))
  }
  try {
    for (const screen of ['inicio', 'materia']) {
      if (screen === 'materia') { await subject.click(); await page.getByText('Apunte-1.pdf', { exact: true }).waitFor() }
      await page.waitForTimeout(10_000)
      await client.send('HeapProfiler.collectGarbage')
      await measure(screen, 0)
      for (let elapsed = 20; elapsed <= 120; elapsed += 20) { await page.waitForTimeout(20_000); await measure(screen, elapsed) }
      await client.send('HeapProfiler.collectGarbage'); await measure(screen, 121)
      const current = samples.filter(sample => sample.screen === screen), first = current[0], last = current.at(-1)
      assert.ok(last.JSHeapUsedSize - first.JSHeapUsedSize < 25 * 1048576, `${screen}: retained heap grew by more than 25 MiB`)
      assert.ok(last.nodes - first.nodes < 300, `${screen}: DOM keeps accumulating`)
      assert.ok(last.jsEventListeners - first.jsEventListeners < 100, `${screen}: listeners keep accumulating`)
      assert.equal(await page.locator('iframe').count(), 0, 'idle Study must not retain a PDF or board iframe')
    }
    assert.deepEqual(errors, [])
  } finally {
    await mkdir('test-results/idle-memory', { recursive: true })
    await writeFile('test-results/idle-memory/samples.json', JSON.stringify({ samples, errors }, null, 2))
    await page.screenshot({ path: 'test-results/idle-memory/materia.png' })
  }
})
