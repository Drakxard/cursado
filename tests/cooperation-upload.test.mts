import assert from 'node:assert/strict'
import test from 'node:test'
import { uploadCooperationFile } from '../lib/client/cooperation-upload.ts'
import { createCooperationR2UploadSession } from '../lib/cooperation-upload-session.ts'
import { build } from 'esbuild'
import { CopyObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { withInscreenRuntimeConfig } from '../lib/inscreen-user-config.ts'

test('empty or truncated upload responses report a recoverable error with HTTP status', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const body of ['', '{"uploadUrl":']) {
    globalThis.fetch = async () => new Response(body, { status: 502 })
    await assert.rejects(uploadCooperationFile('sphere', 'hash', new Blob(['pdf']), 'application/pdf'), /HTTP 502: respuesta JSON vacía o inválida/)
  }
})

test('upload session forwards the Pizarra cookie and refuses rejected membership and foreign origins', async t => {
  const originalFetch = globalThis.fetch, originalBackend = process.env.PIZARRA_BACKEND_URL
  t.after(() => { globalThis.fetch = originalFetch; if (originalBackend === undefined) delete process.env.PIZARRA_BACKEND_URL; else process.env.PIZARRA_BACKEND_URL = originalBackend })
  process.env.PIZARRA_BACKEND_URL = 'https://backend.test'
  const bundle = await build({ entryPoints: ['app/pizarra/upload-session/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'signer', setup(builder) {
    builder.onResolve({ filter: /cooperation-upload-session$/ }, () => ({ path: 'signer', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const hasCooperationR2UploadConfig=()=>globalThis.__cooperationTestR2Config!==false; export async function createCooperationR2UploadSession(input) { return { uploadUrl: "https://r2.test/file", authorizedKey: input.objectKey } }' }))
  } }] })
  const { POST } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
  let allowed = false, exists = false, calls = 0
  globalThis.fetch = async (url, options = {}) => {
    calls++
    assert.equal(new URL(String(url)).host, 'backend.test')
    assert.equal((options.headers as Record<string, string>).Cookie, 'session=secret')
    assert.equal((options.headers as Record<string, string>).Origin, 'https://cursado.vercel.app')
    return allowed ? Response.json({ objectKey: 'authorized/file', bucket: 'estudiodiario', exists, uploadUrl: 'https://worker.test/managed-upload', headers: { 'Content-Type': 'application/pdf' } }) : Response.json({ detail: 'Sin acceso.' }, { status: 403 })
  }
  const request = (origin = 'https://cursado.vercel.app', supportsReuse = true) => new Request('https://cursado.vercel.app/pizarra/upload-session', { method: 'POST', headers: { Origin: origin, Cookie: 'session=secret' }, body: JSON.stringify({ sphereId: 'a'.repeat(36), hash: 'b'.repeat(64), size: 9000000, mime: 'application/pdf', supportsReuse }) })
  assert.equal((await POST(request('https://foreign.test'))).status, 403)
  assert.equal(calls, 0)
  assert.equal((await POST(request())).status, 403)
  allowed = true
  const response = await POST(request())
  assert.equal(response.status, 200)
  assert.equal((await response.json()).authorizedKey, 'authorized/file')
  exists = true
  assert.deepEqual(await (await POST(request())).json(), { exists: true })
  const outdated = await POST(request('https://cursado.vercel.app', false))
  assert.equal(outdated.status, 409)
  assert.match((await outdated.json()).error, /versión anterior/)
  exists = false
  ;(globalThis as any).__cooperationTestR2Config = false
  t.after(() => { delete (globalThis as any).__cooperationTestR2Config })
  const managed = await POST(request())
  assert.equal(managed.status, 200)
  assert.equal((await managed.json()).uploadUrl, 'https://worker.test/managed-upload')
  const invalidPersonalConfig = request()
  invalidPersonalConfig.headers.set('x-inscreen-config-token', 'invalid-personal-file')
  const recovered = await POST(invalidPersonalConfig)
  assert.equal(recovered.status, 200)
  assert.equal((await recovered.json()).uploadUrl, 'https://worker.test/managed-upload')
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
  globalThis.fetch = async () => { calls.push({ url: 'session', options: {} }); return Response.json({ exists: true }) }
  await uploadCooperationFile('sphere', 'hash', blob, 'application/pdf', { configToken: 'sealed-personal-config', workspaceId: 'personal-workspace' })
  assert.equal(calls.length, 1)
  globalThis.fetch = async () => Response.json({})
  await assert.rejects(uploadCooperationFile('sphere', 'hash', blob, 'application/pdf'), /No se recibió una URL/)
  calls.length = 0
  globalThis.fetch = async () => Response.json({ detail: 'No tenés acceso.' }, { status: 403 })
  await assert.rejects(uploadCooperationFile('sphere', 'hash', blob, 'application/pdf'), /No tenés acceso/)
  calls.length = 0
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (calls.length === 1) return Response.json({ uploadUrl: 'https://r2.test/file', fallbackUploadUrl: 'https://worker.test/authorized-upload', fallbackHeaders: { 'Content-Type': 'application/pdf' } })
    return new Response(null, { status: calls.length === 2 ? 403 : 200 })
  }
  await uploadCooperationFile('sphere', 'hash', blob, 'application/pdf')
  assert.equal(calls.length, 3)
  assert.equal(calls[2].url, 'https://worker.test/authorized-upload')
  assert.equal(calls[2].options.credentials, 'omit')
})

test('direct R2 URL binds checksum, size and MIME and expires in fifteen minutes', async t => {
  const names = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] } })
  Object.assign(process.env, { R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'estudiodiario' })
  const session = await createCooperationR2UploadSession({ objectKey: 'cursado/shared/sphere/file', bucket: 'estudiodiario', hash: 'ab'.repeat(32), size: 9 * 1024 * 1024, mime: 'application/pdf' })
  assert.ok(session.uploadUrl && session.headers)
  const url = new URL(session.uploadUrl)
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900')
  for (const header of ['content-length', 'content-type', 'x-amz-checksum-sha256']) assert.ok(url.searchParams.get('X-Amz-SignedHeaders')!.split(';').includes(header))
  assert.equal(session.headers['x-amz-checksum-sha256'], Buffer.from('ab'.repeat(32), 'hex').toString('base64'))
  assert.equal(url.searchParams.get('x-amz-checksum-crc32'), null)
  await assert.rejects(createCooperationR2UploadSession({ objectKey: 'key', bucket: 'wrong', hash: 'ab'.repeat(32), size: 1, mime: 'text/plain' }))
})

test('personal R2 configuration reuses only a byte-verified backup and protects against concurrent replacement', async t => {
  const original = S3Client.prototype.send
  t.after(() => { S3Client.prototype.send = original })
  const bytes = Buffer.from('existing private PDF'), hash = createHash('sha256').update(bytes).digest('hex')
  const copies: CopyObjectCommand[] = []
  let corrupt = false, replaced = false
  S3Client.prototype.send = (async function(command) {
    if (command instanceof GetObjectCommand) {
      assert.equal(command.input.Key, `manifests/workspace-library/personal-workspace/blobs/${hash}`)
      return { ContentLength: bytes.length, ETag: 'original-etag', Body: { transformToWebStream: () => new Blob([corrupt ? Buffer.alloc(bytes.length) : bytes]).stream() } }
    }
    assert.ok(command instanceof CopyObjectCommand)
    copies.push(command)
    if (replaced) throw Object.assign(new Error('replaced'), { $metadata: { httpStatusCode: 412 } })
    return {}
  }) as typeof S3Client.prototype.send
  const config = { R2_BUCKET_NAME: 'estudiodiario', R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com', R2_ACCESS_KEY_ID: 'personal-key', R2_SECRET_ACCESS_KEY: 'personal-secret' }
  const input = { objectKey: `cursado/shared/sphere/${hash}`, bucket: 'estudiodiario', hash, size: bytes.length, mime: 'application/pdf', workspaceId: 'personal-workspace' }
  assert.deepEqual(await withInscreenRuntimeConfig(config, () => createCooperationR2UploadSession(input)), { exists: true })
  assert.equal(copies[0].input.CopySourceIfMatch, 'original-etag')
  assert.equal(copies[0].input.Key, input.objectKey)
  corrupt = true
  assert.ok((await withInscreenRuntimeConfig(config, () => createCooperationR2UploadSession(input))).uploadUrl)
  assert.equal(copies.length, 1)
  corrupt = false; replaced = true
  assert.ok((await withInscreenRuntimeConfig(config, () => createCooperationR2UploadSession(input))).uploadUrl)
})
