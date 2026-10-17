import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { sealInscreenUserConfig } from '../lib/inscreen-user-config.ts'
import { loadServicesFile } from '../lib/local-workspace-client.ts'

test('R2 connection reuses deployment credentials and gives personal configuration priority without masking recovery errors', async () => {
  const fields = ['R2_BUCKET_NAME', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'INSCREEN_CONFIG_SEED'] as const
  const previous = Object.fromEntries(fields.map(field => [field, process.env[field]]))
  try {
    process.env.INSCREEN_CONFIG_SEED = 'workspace-library-test-seed-at-least-32-characters'
    const deployed = { R2_BUCKET_NAME: 'existing-bucket', R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, R2_ACCESS_KEY_ID: 'existing-key', R2_SECRET_ACCESS_KEY: 'existing-secret' }
    Object.assign(process.env, deployed)
    const bundle = await build({ entryPoints: ['lib/server/workspace-library-config.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' })
    const module = { exports: {} as { workspaceLibraryConfig: (request: Request) => { source: string; r2: typeof deployed } } }
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
    const resolve = module.exports.workspaceLibraryConfig
    assert.equal(resolve(new Request('https://cursado.test')).source, 'deployment')
    const local = { ...deployed, R2_BUCKET_NAME: 'personal-bucket' }
    const token = sealInscreenUserConfig(local)
    const fromFile = resolve(new Request('https://cursado.test', { headers: { 'x-inscreen-config-token': token } }))
    assert.equal(fromFile.source, 'workspace'); assert.equal(fromFile.r2.R2_BUCKET_NAME, 'personal-bucket')
    assert.throws(() => resolve(new Request('https://cursado.test', { headers: { 'x-inscreen-config-token': 'damaged' } })))
    const otherServices = sealInscreenUserConfig({ GROQ_API_KEY: 'other-service' })
    assert.equal(resolve(new Request('https://cursado.test', { headers: { 'x-inscreen-config-token': otherServices } })).source, 'deployment')
    delete process.env.R2_SECRET_ACCESS_KEY
    assert.equal(resolve(new Request('https://cursado.test')).source, 'none')
  } finally { for (const field of fields) { if (previous[field] === undefined) delete process.env[field]; else process.env[field] = previous[field] } }
})

test('a surviving User.Services backup is reused when the primary file is missing', async () => {
  const value = { version: 1, inscreenToken: 'previously-saved-token', driveToken: '', seedFingerprint: '', validatedAt: '', savedAt: new Date().toISOString() }
  const root = { async getFileHandle(name: string) { if (name === 'User.Services.backup') return { getFile: async () => new File([JSON.stringify(value)], name) }; throw new DOMException('Not found', 'NotFoundError') } } as unknown as FileSystemDirectoryHandle
  assert.equal((await loadServicesFile(root))?.inscreenToken, value.inscreenToken)
  const empty = { async getFileHandle() { throw new DOMException('Not found', 'NotFoundError') } } as unknown as FileSystemDirectoryHandle
  assert.equal(await loadServicesFile(empty), null)
})
