import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { openLibraryToken, sealLibraryToken } from '../lib/server/workspace-library-tokens.ts'
import type { LibraryManifest } from '../lib/workspace-library.ts'

test('publication commits only complete inventories; QR claims, device isolation and revocation use persistent R2 state', async () => {
  process.env.INSCREEN_PROVIDER_CAPSULE_SECRET = 'workspace-api-test-secret-at-least-32-characters'
  type ObjectValue = { body: string; etag: string; size: number; metadata: Record<string, string> }
  const objects = new Map<string, ObjectValue>()
  let sequence = 0
  let corsRules: Record<string, unknown>[] = [], corsWrites = 0, corsForbidden = false
  const failure = (status: number) => Object.assign(new Error(`R2 ${status}`), { $metadata: { httpStatusCode: status } })
  const execute = async (command: { kind: string; input: Record<string, unknown> }) => {
    const input = command.input, key = String(input.Key || ''), old = objects.get(key)
    switch (command.kind) {
      case 'GetObjectCommand': if (!old) throw failure(404); return { Body: { transformToString: async () => old.body, transformToWebStream: () => new Blob([old.body]).stream() }, ContentLength: old.size, ETag: old.etag }
      case 'HeadObjectCommand': if (!old) throw failure(404); return { ContentLength: old.size, ContentType: 'application/pdf', Metadata: old.metadata }
      case 'CopyObjectCommand': {
        const source = objects.get(decodeURIComponent(String(input.CopySource).slice('fixture/'.length)))
        if (!source) throw failure(404)
        assert.equal(input.CopySourceIfMatch, source.etag)
        objects.set(key, { ...source, etag: String(++sequence), metadata: input.Metadata as Record<string, string> }); return {}
      }
      case 'DeleteObjectCommand': objects.delete(key); return {}
      case 'PutObjectCommand': {
        if (input.IfNoneMatch === '*' && old || input.IfMatch && old?.etag !== input.IfMatch) throw failure(412)
        const body = String(input.Body)
        objects.set(key, { body, etag: String(++sequence), size: Buffer.byteLength(body), metadata: {} }); return {}
      }
      case 'ListObjectsV2Command': return { Contents: [...objects.keys()].filter(k => k.startsWith(String(input.Prefix))).map(Key => ({ Key })) }
      case 'GetBucketCorsCommand': if (corsForbidden) throw failure(403); return { CORSRules: corsRules }
      case 'PutBucketCorsCommand': corsRules = (input.CORSConfiguration as { CORSRules: Record<string, unknown>[] }).CORSRules; corsWrites++; return {}
      default: return {}
    }
  }
  const commands = ['GetObjectCommand', 'HeadObjectCommand', 'PutObjectCommand', 'CopyObjectCommand', 'DeleteObjectCommand', 'GetBucketCorsCommand', 'PutBucketCorsCommand', 'CreateMultipartUploadCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand', 'ListObjectsV2Command']
  const fixtures: Record<string, string> = {
    '@/lib/authz': 'export async function requireAuthSession(){return {response:null}}',
    '@/lib/inscreen-user-config': 'export function readInscreenUserConfig(request){if(request.headers.get("x-inscreen-config-token")!=="owner")throw Error("Missing configuration");return {R2_BUCKET_NAME:"fixture",R2_ENDPOINT:"https://fixture.r2.cloudflarestorage.com",R2_ACCESS_KEY_ID:"key",R2_SECRET_ACCESS_KEY:"secret"}} export function getInscreenR2Config(config){return config} export function normalizeInscreenUserConfig(config){return config}',
    '@aws-sdk/client-s3': `export class S3Client {send(command){return globalThis.__libraryExecute(command)}}\n${commands.map(name => `export class ${name} {constructor(input){this.input=input;this.kind='${name}'}}`).join('\n')}`,
    '@aws-sdk/s3-request-presigner': 'export async function getSignedUrl(client,command){return "https://fixture.r2.cloudflarestorage.com/"+command.input.Key}',
  }
  const bundle = await build({ entryPoints: ['lib/server/workspace-library.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'persistent-storage-fixture', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in fixtures ? { path: args.path, namespace: 'fixture' } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'js' }))
  } }] })
  const globals = globalThis as unknown as { __libraryExecute: typeof execute }; globals.__libraryExecute = execute
  const module = { exports: {} as { handleLibraryRequest: (request: Request, action: string) => Promise<Response> } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const handler = module.exports.handleLibraryRequest
  const workspaceId = 'workspace-api-fixture-12345', root = `manifests/workspace-library/${workspaceId}/`
  const inventory: LibraryManifest = { version: 1, workspaceId, revision: 'revision-api-fixture-12345', name: 'Biblioteca de prueba', publishedAt: new Date().toISOString(), subjects: [], items: [], files: [{ id: 'a'.repeat(64), hash: 'b'.repeat(64), path: 'teoria/archivo.pdf', size: 4, mime: 'application/pdf' }] }
  async function owner(action: string, data: Record<string, unknown> = {}, method = 'POST') {
    const request = new Request(`https://cursado.example/api/inscreen/workspace/${action}${method === 'GET' ? `?workspaceId=${workspaceId}` : ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-inscreen-config-token': 'owner', Origin: 'https://cursado.example' }, ...(method === 'POST' ? { body: JSON.stringify({ workspaceId, ...data }) } : {}) })
    return handler(request, action)
  }
  async function redeem(uri: string, installationId: string) {
    const token = new URL(uri).searchParams.get('token')
    return handler(new Request('https://cursado.example/api/inscreen/workspace/pairing/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, installationId, name: 'Android de prueba' }) }), 'pairing/redeem')
  }
  assert.equal((await (await owner('cors')).json()).corsManaged, true)
  assert.equal(corsWrites, 1)
  assert.deepEqual(corsRules[0].AllowedOrigins, ['https://cursado.example'])
  await owner('cors'); assert.equal(corsWrites, 1)
  // A matching origin and PUT alone do not allow upload metadata or expose ETag.
  corsRules[0].AllowedHeaders = []
  await owner('cors'); assert.equal(corsWrites, 2)
  assert.deepEqual(corsRules[0].AllowedHeaders, ['content-type', 'x-amz-*'])
  corsForbidden = true
  assert.equal((await (await owner('cors')).json()).corsManaged, false)
  corsForbidden = false
  const oldKey = 'r2/calculo-2/semana-1/lunes/123-guia.pdf', oldBody = 'Previously uploaded PDF'
  objects.set(oldKey, { body: oldBody, etag: 'old-r2-etag', size: oldBody.length, metadata: {} })
  objects.set('manifests/inscreen/provider/private.json', { body: '{"secret":"excluded"}', etag: 'private', size: 21, metadata: {} })
  const legacy = await (await owner('legacy/catalog', {}, 'GET')).json()
  assert.equal(legacy.files.length, 1)
  assert.equal(legacy.documents[0].data.materials[0].material_type, 'practice')
  assert.equal(legacy.documents.some((doc: { path: string }) => doc.path.includes('private')), false)
  const oldHash = createHash('sha256').update(oldBody).digest('hex')
  const reuse = await (await owner('upload', { hash: oldHash, size: oldBody.length, mime: 'application/pdf', previousKey: oldKey })).json()
  assert.equal(reuse.reused, true)
  assert.equal(objects.get(root + 'blobs/' + oldHash)?.body, oldBody)
  assert.equal(objects.get(oldKey)?.etag, 'old-r2-etag')
  assert.equal((await (await owner('upload', { hash: 'e'.repeat(64), size: oldBody.length, mime: 'application/pdf', previousKey: oldKey })).json()).reused, undefined)
  const originalFetch = globalThis.fetch
  try {
    for (const problem of ['authorization', 'cors', 'network']) {
      globalThis.fetch = async (_url, options) => options?.method === 'OPTIONS'
        ? new Response(null, { status: problem === 'cors' ? 403 : 200, headers: { 'Access-Control-Allow-Origin': 'https://cursado.example' } })
        : new Response(problem === 'authorization' ? '<Error><Code>SignatureDoesNotMatch</Code><Message>private internal diagnostic</Message></Error>' : '', { status: problem === 'authorization' ? 403 : 200 })
      const diagnosis = await (await owner('upload/diagnose')).json()
      assert.equal(diagnosis.problem, problem)
      if (problem === 'authorization') { assert.match(diagnosis.message, /SignatureDoesNotMatch/); assert.doesNotMatch(diagnosis.message, /private internal diagnostic/) }
    }
  } finally { globalThis.fetch = originalFetch }
  assert.equal((await owner('pairing/create')).status, 409)
  assert.equal((await owner('publish', { manifest: inventory })).status, 400)
  assert.equal(objects.has(root + 'current.json'), false)
  objects.set(root + 'blobs/' + 'b'.repeat(64), { body: 'data', etag: 'blob', size: 4, metadata: { sha256: 'b'.repeat(64) } })
  assert.equal((await owner('publish', { manifest: inventory })).status, 200)
  assert.equal((await owner('publish', { manifest: inventory })).status, 409)
  const pairing = await (await owner('pairing/create')).json()
  const races = await Promise.all([redeem(pairing.pairingUri, 'installation-first-123456'), redeem(pairing.pairingUri, 'installation-second-123456')])
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409])
  const winnerIndex = races.findIndex(r => r.status === 200), paired = await races[winnerIndex].json()
  const winner = winnerIndex === 0 ? 'installation-first-123456' : 'installation-second-123456'
  assert.equal((await redeem(pairing.pairingUri, winner)).status, 200)
  const device = async (action: string, token = paired.token) => handler(new Request(`https://cursado.example/api/inscreen/workspace/${action}`, { headers: { Authorization: `Bearer ${token}` } }), action.split('?')[0])
  assert.equal((await device('manifest')).status, 200)
  assert.equal((await device('manifest', paired.token + 'tampered')).status, 401)
  assert.equal((await device(`download?id=${'a'.repeat(64)}&revision=${inventory.revision}`)).status, 200)
  assert.equal((await device(`download?id=${'c'.repeat(64)}&revision=${inventory.revision}`)).status, 404)
  const expiry = openLibraryToken<Record<string, unknown>>('pairing', new URL(pairing.pairingUri).searchParams.get('token')!)
  const expired = new URL(pairing.pairingUri); expired.searchParams.set('token', sealLibraryToken('pairing', { ...expiry, expiresAt: Date.now() - 1 }))
  assert.equal((await redeem(expired.toString(), winner)).status, 410)
  const broken: LibraryManifest = { ...inventory, revision: 'revision-broken-12345678', files: [{ ...inventory.files[0], hash: 'd'.repeat(64) }] }
  assert.equal((await owner('publish', { previousRevision: inventory.revision, manifest: broken })).status, 400)
  assert.equal(JSON.parse(objects.get(root + 'current.json')!.body).revision, inventory.revision)
  const deleted: LibraryManifest = { ...inventory, revision: 'revision-deleted-12345678', files: [] }
  assert.equal((await owner('publish', { previousRevision: inventory.revision, manifest: deleted })).status, 200)
  // A download already in progress can still finish its authorized revision.
  assert.equal((await device(`download?id=${'a'.repeat(64)}&revision=${inventory.revision}`)).status, 200)
  const devices = await (await owner('devices', {}, 'GET')).json()
  assert.equal(devices.devices.length, 1)
  assert.equal((await owner('devices/revoke', { deviceId: devices.devices[0].deviceId })).status, 200)
  assert.equal((await device('manifest')).status, 403)
  assert.equal((await redeem(pairing.pairingUri, winner)).status, 403)
})
