import assert from 'node:assert/strict'
import test from 'node:test'
import { libraryId, isLibraryPath, validateLibraryManifest, type LibraryManifest } from '../lib/workspace-library.ts'
import { sealLibraryToken, openLibraryToken } from '../lib/server/workspace-library-tokens.ts'

const secret = 'library-test-secret-which-is-at-least-32-characters'
const workspaceId = 'test-workspace-12345678'
const manifest = (): LibraryManifest => ({ version: 1, workspaceId, revision: 'test-revision-12345678', name: 'Cursado', publishedAt: new Date().toISOString(), subjects: [{ id: 'calculo', name: 'Cálculo', color: '#ffcc00' }], files: [{ id: 'a'.repeat(64), path: 'teoria/Cálculo/semana-1/archivo.pdf', hash: 'b'.repeat(64), size: 32, mime: 'application/pdf' }], items: [{ id: 'material:1', title: 'Apunte', kind: 'pdf', fileId: 'a'.repeat(64), subjectId: 'calculo', week: 1 }] })

test('publication excludes credentials, technical manifests, backups and traversal', () => {
  for (const path of ['User.Services', 'User.InScreen', 'manifests/User.Services', 'manifests/drive-sync.json', 'manifests/azure-sync.json', 'manifests/workspace-library-sync.json', 'manifests/inscreen/provider/devices/key.json', 'manifests/sintesis/copias/old.json', 'manifests/sintesis/migracion-navegador/raw.json', 'manifests/sintesis/calculo/semana-1/workspace.backup.json', 'teoria/../secret', 'teoria/./secret', 'teoria\\secret', 'teoria//secret']) assert.equal(isLibraryPath(path), false, path)
  for (const path of ['manifests/materials/calculo/week-1.json', 'manifests/entries/calculo/week-1.json', 'manifests/sintesis/calculo/semana-1/workspace.json', 'sintesis/images/image.png', 'manifests/pdf-explanations/key/id.html', 'teoria/Cálculo/synchronization.pdf', 'boards/scene.json', 'boards/asset.bin']) assert.equal(isLibraryPath(path), true, path)
})
test('manifest validates references, unique paths, identifiers and sizes', () => {
  assert.equal(validateLibraryManifest(manifest()).workspaceId, workspaceId)
  assert.throws(() => libraryId('../some-other-workspace'))
  const duplicate = manifest(); duplicate.files.push({ ...duplicate.files[0] }); assert.throws(() => validateLibraryManifest(duplicate))
  const missing = manifest(); missing.items[0].fileId = 'c'.repeat(64); assert.throws(() => validateLibraryManifest(missing))
  const badSize = manifest(); badSize.files[0].size = -1; assert.throws(() => validateLibraryManifest(badSize))
  const secretFile = manifest(); secretFile.files[0].path = 'manifests/credentials.json'; assert.throws(() => validateLibraryManifest(secretFile))
  const deletion = manifest(); deletion.items = []; deletion.files = []; assert.equal(validateLibraryManifest(deletion).files.length, 0)
})
test('library credentials are opaque, authenticated and separated by purpose and seed', () => {
  const value = { workspaceId, r2: { R2_SECRET_ACCESS_KEY: 'test-r2-secret' }, expiresAt: 123 }
  const sealed = sealLibraryToken('pairing', value, secret)
  assert.equal(sealed.includes('test-r2-secret'), false)
  assert.deepEqual(openLibraryToken('pairing', sealed, secret), value)
  assert.notEqual(sealLibraryToken('pairing', value, secret), sealed)
  assert.throws(() => openLibraryToken('device', sealed, secret))
  assert.throws(() => openLibraryToken('pairing', sealed, secret + '-changed'))
  const fields = sealed.split('.'); fields[2] = (fields[2][0] === 'a' ? 'b' : 'a') + fields[2].slice(1)
  assert.throws(() => openLibraryToken('pairing', fields.join('.'), secret))
  assert.throws(() => sealLibraryToken('pairing', value, 'short'))
})
