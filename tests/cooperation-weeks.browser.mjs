import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const origin = process.env.CURSADO_TEST_URL || 'http://localhost:3000'

test('actual sphere resumes week selection, navigates, finishes and retains only chosen metadata', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) })
  const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage()
  t.after(async () => {
    if (t.error) {
      console.error((await page.locator('body').innerText().catch(() => '')).slice(-4500))
      console.error(await page.evaluate(async () => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('week-selection-test')
        const manifests = await root.getDirectoryHandle('manifests'), dir = await (await manifests.getDirectoryHandle('materials')).getDirectoryHandle('Cooperativo-sphere-selection')
        return { catalog: JSON.parse(await (await (await manifests.getFileHandle('subject-catalog.json')).getFile()).text()), manifest: JSON.parse(await (await (await dir.getFileHandle('week-1.json')).getFile()).text()), response: await (await fetch('/api/subject-day-materials?subjectId=coop-sphere-selection&weekNumber=1&scope=week')).json() }
      }).catch(error => String(error)))
    }
    await browser.close()
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const binding = { id: 'sphere-selection', groupId: 'group-selection', subjectId: 'coop-sphere-selection', storageKey: 'Cooperativo-sphere-selection', sourceId: 'source', sourceKey: 'Source', name: 'Prog 3', color: '#f97316', owner: false }
  const sphere = { id: binding.id, group_id: binding.groupId, name: binding.name, color: binding.color, created_by: 'a', ready: true, bytes: 0 }
  const groups = [{ id: binding.groupId, accepted: true, members: [{ id: 'a', display_name: 'Rafa' }, { id: 'b', display_name: 'Compañero' }], spheres: [sphere] }]
  const resources = Object.fromEntries([
    { key: 'sphere.json', type: 'json', value: { subjectId: 'source', storageKey: 'Source', name: binding.name, color: binding.color } },
    ...[1,2].map(week => ({ key: `manifests/materials/Source/week-${week}.json`, type: 'json', value: { version: 1, subjectId: 'source', weekNumber: week, materials: [{ id: week * 100, subject_id: 'source', file_name: `Semana-${week}.pdf`, drive_file_id: `workspace://teoria/Source/semana-${week}.pdf`, material_type: 'theory', week_number: week, weekday_index: 0, session_date: week === 1 ? '2026-03-14' : '2026-03-23', created_at: '2026-03-14', updated_at: '2026-03-14', order_index: 0 }] } })),
  ].map(resource => [resource.key, resource]))
  const snapshot = { seq: 1, resources, conflicts: [] }
  await context.route('**/pizarra/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/cooperation/groups')) return route.fulfill({ json: { user: { id: 'b' }, groups } })
    if (path.endsWith('/snapshot')) return route.fulfill({ json: snapshot })
    if (path.endsWith('/operations')) return route.fulfill({ json: { seq: 1 } })
    return route.fulfill({ status: 401, json: { error: 'No session' } })
  })
  await page.goto(origin)
  await page.evaluate(async ({ binding, groups, snapshot }) => {
    localStorage.setItem('inscreen.config-skipped.v1', '1')
    localStorage.setItem('cursado-cooperation-user', 'b')
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('week-selection-test', { create: true })
    const write = async (path, value) => {
      const parts = path.split('/'); let dir = root
      for (const part of parts.slice(0,-1)) dir = await dir.getDirectoryHandle(part, { create: true })
      const writer = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable()
      await writer.write(JSON.stringify(value)); await writer.close()
    }
    const now = new Date().toISOString(), tabId = `cooperative-${binding.groupId}`
    const subject = { id: binding.subjectId, name: binding.name, storageKey: binding.storageKey, color: binding.color, tabId, createdAt: now, targetWeekday: 0 }
    await write('manifests/subject-catalog.json', { version: 2, subjects: { [subject.id]: { ...subject, normalizedName: 'prog 3', cooperationId: binding.id, updatedAt: now } } })
    await write('manifests/workspace-state.json', { workspaceTabs: { [tabId]: { id: tabId, name: 'Cooperativo', color: '#16a34a', createdAt: now, subjectIds: [subject.id] } }, activeWorkspaceTabId: tabId, isMainWorkspaceTabVisible: true, subjectWeekdays: {}, customSubjects: { [subject.id]: subject } })
    await write('.cooperation/b/state.json', { version: 1, userId: 'b', groups, deletions: [], mirrors: { [binding.id]: { binding, selection: { choosing: true, excludedWeeks: [1,2], weeks: [1,2] }, downloading: true, metadataReady: true, baseline: { seq: 0, resources: {}, conflicts: [] }, incoming: snapshot } } })
    const db = await new Promise((resolve,reject) => { const request = indexedDB.open('local-workspace',1); request.onupgradeneeded = () => request.result.createObjectStore('workspace',{keyPath:'id'}); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve,reject) => { const tx = db.transaction('workspace','readwrite'); tx.objectStore('workspace').put({id:'root-handle',handle:root}); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error) }); db.close()
  }, { binding, groups, snapshot })
  await page.goto(origin + '/estudio')
  const toggle = page.getByRole('button', { name: /Sincronizar.*Semana/ })
  await toggle.getByText('Semana 1', { exact: true }).waitFor()
  await page.getByText('Semana-1.pdf', { exact: true }).first().waitFor()
  assert.equal(await page.getByText('El manifiesto existe, pero falta el archivo. No se elimino la referencia.', { exact: true }).count(), 0)
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  await toggle.click()
  await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.textContent?.includes('Sincronizar'))
  await page.keyboard.press('>'); await toggle.getByText('Semana 2', { exact: true }).waitFor()
  await page.getByText('Semana-2.pdf', { exact: true }).first().waitFor()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  await page.keyboard.press('<'); await toggle.getByText('Semana 1', { exact: true }).waitFor()
  await page.getByText('Semana-1.pdf', { exact: true }).first().waitFor()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/cooperation-week-selection.png' })
  await page.getByRole('button', { name: 'Terminar', exact: true }).click()
  await toggle.waitFor({ state: 'hidden' })
  const saved = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('week-selection-test')
    const dir = await (await root.getDirectoryHandle('.cooperation')).getDirectoryHandle('b')
    const state = JSON.parse(await (await (await dir.getFileHandle('state.json')).getFile()).text())
    const materials = await (await (await root.getDirectoryHandle('manifests')).getDirectoryHandle('materials')).getDirectoryHandle('Cooperativo-sphere-selection')
    const names = []; for await (const [name] of materials.entries()) names.push(name)
    return { selection: state.mirrors['sphere-selection'].selection, names }
  })
  assert.deepEqual(saved.selection.excludedWeeks, [2])
  assert.equal(saved.selection.choosing, false)
  assert.ok(saved.names.includes('week-1.json'))
  assert.equal(saved.names.includes('week-2.json'), false)
  assert.deepEqual(errors, [])
})
