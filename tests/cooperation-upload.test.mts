import assert from 'node:assert/strict'
import test from 'node:test'
import { uploadCooperationFile } from '../lib/client/cooperation-upload.ts'
import { createCooperationR2UploadSession } from '../lib/cooperation-upload-session.ts'
import { build } from 'esbuild'

test('upload session forwards the Pizarra cookie and refuses rejected membership and foreign origins', async t => {
  const originalFetch = globalThis.fetch, originalBackend = process.env.PIZARRA_BACKEND_URL
  t.after(() => { globalThis.fetch = originalFetch; if (originalBackend === undefined) delete process.env.PIZARRA_BACKEND_URL; else process.env.PIZARRA_BACKEND_URL = originalBackend })
  process.env.PIZARRA_BACKEND_URL = 'https://backend.test'
  const bundle = await build({ entryPoints: ['app/pizarra/upload-session/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'signer', setup(builder) {
    builder.onResolve({ filter: /cooperation-upload-session$/ }, () => ({ path: 'signer', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function createCooperationR2UploadSession(input) { return { uploadUrl: "https://r2.test/file", authorizedKey: input.objectKey } }' }))
  } }] })
  const { POST } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
  let allowed = false, calls = 0
  globalThis.fetch = async (url, options = {}) => {
    calls++
    assert.equal(new URL(String(url)).host, 'backend.test')
    assert.equal((options.headers as Record<string, string>).Cookie, 'session=secret')
    assert.equal((options.headers as Record<string, string>).Origin, 'https://cursado.vercel.app')
    return allowed ? Response.json({ objectKey: 'authorized/file', bucket: 'estudiodiario' }) : Response.json({ detail: 'Sin acceso.' }, { status: 403 })
  }
  const request = (origin = 'https://cursado.vercel.app') => new Request('https://cursado.vercel.app/pizarra/upload-session', { method: 'POST', headers: { Origin: origin, Cookie: 'session=secret' }, body: JSON.stringify({ sphereId: 'a'.repeat(36), hash: 'b'.repeat(64), size: 9000000, mime: 'application/pdf' }) })
  assert.equal((await POST(request('https://foreign.test'))).status, 403)
  assert.equal(calls, 0)
  assert.equal((await POST(request())).status, 403)
  allowed = true
  const response = await POST(request())
  assert.equal(response.status, 200)
  assert.equal((await response.json()).authorizedKey, 'authorized/file')
})

test('large cooperative files go directly to R2; authorization receives metadata only', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const blob = new Blob([new Uint8Array(9 * 1024 * 1024)])
  const calls: { url: string; options: RequestInit }[] = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return calls.length === 1 ? Response.json({ uploadUrl: 'https://r2.test/file', headers: { 'x-amz-checksum-sha256': 'checksum' } }) : new Response(null)
  }
  await uploadCooperationFile('sphere', 'hash', blob, 'application/pdf')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/pizarra/upload-session')
  assert.ok(String(calls[0].options.body).length < 1024)
  assert.equal(calls[1].url, 'https://r2.test/file')
  assert.equal(calls[1].options.body, blob)
  assert.equal(calls[1].options.credentials, 'omit')
  calls.length = 0
  globalThis.fetch = async () => Response.json({ detail: 'No tenés acceso.' }, { status: 403 })
  await assert.rejects(uploadCooperationFile('sphere', 'hash', blob, 'application/pdf'), /No tenés acceso/)
})

test('direct R2 URL binds checksum, size and MIME and expires in fifteen minutes', async t => {
  const names = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] } })
  Object.assign(process.env, { R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'estudiodiario' })
  const session = await createCooperationR2UploadSession({ objectKey: 'cursado/shared/sphere/file', bucket: 'estudiodiario', hash: 'ab'.repeat(32), size: 9 * 1024 * 1024, mime: 'application/pdf' })
  const url = new URL(session.uploadUrl)
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900')
  for (const header of ['content-length', 'content-type', 'x-amz-checksum-sha256']) assert.ok(url.searchParams.get('X-Amz-SignedHeaders')!.split(';').includes(header))
  assert.equal(session.headers['x-amz-checksum-sha256'], Buffer.from('ab'.repeat(32), 'hex').toString('base64'))
  assert.equal(url.searchParams.get('x-amz-checksum-crc32'), null)
  await assert.rejects(createCooperationR2UploadSession({ objectKey: 'key', bucket: 'wrong', hash: 'ab'.repeat(32), size: 1, mime: 'text/plain' }))
})
