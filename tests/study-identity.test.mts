import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['pizarra-sync/packages/client-web/src/identity.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' })
const { loadBoardIdentity, saveBoardIdentity } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
function storage(values: Record<string, string> = {}) {
  const entries = new Map(Object.entries(values))
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) } }
}

test('the previous Pizarra user replaces a generated guest and remains saved across reopens', () => {
  const saved = storage({ 'komuboard-uid': 'stable-browser-id', 'komuboard-name': 'Auburn Gecko', 'pizarra-perfil-copia': JSON.stringify({ id: 'account', display_name: 'Rafa', color: '#123456' }), 'komuboard-grid': 'lines' })
  const restored = loadBoardIdentity(saved)
  assert.equal(restored.name, 'Rafa'); assert.equal(restored.color, '#123456')
  assert.equal(restored.id, 'stable-browser-id'); assert.equal(restored.fresh, false)
  assert.equal(loadBoardIdentity(saved).name, 'Rafa')
  assert.equal(saved.getItem('komuboard-grid'), 'lines')
  saveBoardIdentity({ ...restored, name: 'Rafael', color: '#abcdef', customized: true }, saved)
  assert.equal(loadBoardIdentity(saved, { display_name: 'Old account name', color: '#000000' }).name, 'Rafael')
  assert.equal(loadBoardIdentity(saved).color, '#abcdef')
})

test('custom existing names and fresh anonymous identities both persist without regeneration', () => {
  const custom = storage({ 'komuboard-name': 'Nombre elegido', 'pizarra-perfil-copia': JSON.stringify({ display_name: 'Anterior' }) })
  assert.equal(loadBoardIdentity(custom).name, 'Nombre elegido')
  const empty = storage({ 'pizarra-perfil-copia': '{invalid' })
  const first = loadBoardIdentity(empty), reopened = loadBoardIdentity(empty)
  assert.equal(first.fresh, true); assert.equal(reopened.fresh, false)
  assert.equal(first.id, reopened.id); assert.equal(first.name, reopened.name)
  const account = loadBoardIdentity(empty, { display_name: 'Cuenta guardada', color: '#112233' })
  assert.equal(account.name, 'Cuenta guardada'); assert.equal(account.customized, true)
})
