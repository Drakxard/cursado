import { randomUUID } from 'node:crypto'
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, GetBucketCorsCommand, PutBucketCorsCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectsV2Command, type CORSRule } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAuthSession } from '@/lib/authz'
import { type InscreenR2Config } from '@/lib/inscreen-user-config'
import { workspaceLibraryConfig } from './workspace-library-config'
import { libraryHash, libraryId, validateLibraryManifest, type LibraryManifest } from '@/lib/workspace-library'
import { openLibraryToken, sealLibraryToken } from './workspace-library-tokens'

type Access = { workspaceId: string; r2: InscreenR2Config; deviceId?: string; pairingId?: string; expiresAt?: number; origin?: string }
type Device = { deviceId: string; installationId: string; name: string; enabled: boolean; createdAt: string; revokedAt?: string }
type Pairing = { deviceId: string; expiresAt: number; installationId: string | null; name?: string }
class LibraryError extends Error { constructor(public status: number, message: string) { super(message) } }
const prefix = (id: string) => `manifests/workspace-library/${libraryId(id)}/`
const blobKey = (id: string, hash: string) => `${prefix(id)}blobs/${libraryHash(hash)}`
function storage(r2: InscreenR2Config) {
  if (!r2.R2_BUCKET_NAME || !r2.R2_ENDPOINT || !r2.R2_ACCESS_KEY_ID || !r2.R2_SECRET_ACCESS_KEY) throw new LibraryError(428, 'Configurá Cloudflare R2.')
  return { client: new S3Client({ region: 'auto', endpoint: r2.R2_ENDPOINT, credentials: { accessKeyId: r2.R2_ACCESS_KEY_ID, secretAccessKey: r2.R2_SECRET_ACCESS_KEY } }), bucket: r2.R2_BUCKET_NAME }
}
function missing(error: unknown) { return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404 }
async function read<T>(s: ReturnType<typeof storage>, key: string) {
  const result = await s.client.send(new GetObjectCommand({ Bucket: s.bucket, Key: key }))
  return { value: JSON.parse(await result.Body!.transformToString()) as T, etag: result.ETag }
}
async function write(s: ReturnType<typeof storage>, key: string, value: unknown, condition: { IfMatch?: string; IfNoneMatch?: string } = {}) {
  await s.client.send(new PutObjectCommand({ Bucket: s.bucket, Key: key, ContentType: 'application/json', Body: JSON.stringify(value), ...condition }))
}
async function manifest(s: ReturnType<typeof storage>, id: string) {
  try { return await read<LibraryManifest>(s, `${prefix(id)}current.json`) }
  catch (error) { if (missing(error)) return null; throw error }
}
function bearer(request: Request) { return request.headers.get('authorization')?.replace(/^Bearer /, '') || '' }
async function deviceAccess(request: Request) {
  let access: Access
  try { access = openLibraryToken<Access>('device', bearer(request)); libraryId(access.workspaceId); libraryId(access.deviceId) }
  catch { throw new LibraryError(401, 'Vínculo inválido. Volvé a vincular este dispositivo.') }
  const s = storage(access.r2)
  if (access.origin && access.origin !== new URL(request.url).origin) throw new LibraryError(403, 'El vínculo pertenece a otro despliegue de Cursado.')
  let device: Device
  try { device = (await read<Device>(s, `${prefix(access.workspaceId)}devices/${access.deviceId}.json`)).value }
  catch (error) { if (missing(error)) throw new LibraryError(403, 'Dispositivo desvinculado.'); throw error }
  if (!device.enabled) throw new LibraryError(403, 'Dispositivo desvinculado.')
  return { access, s }
}
async function ownerAccess(request: Request, id: string) {
  const auth = await requireAuthSession()
  if (auth.response) throw new LibraryError(401, 'Ingresá a Cursado.')
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) throw new LibraryError(403, 'Origen inválido.')
  return { workspaceId: libraryId(id), r2: workspaceLibraryConfig(request).r2 }
}
async function setupCors(s: ReturnType<typeof storage>, origin: string) {
  let rules: CORSRule[]
  try { rules = (await s.client.send(new GetBucketCorsCommand({ Bucket: s.bucket }))).CORSRules || [] }
  catch (error) { if (!missing(error)) throw error; rules = [] }
  const id = `cursado-library-${new URL(origin).hostname}`.slice(0, 255)
  const rule = { ID: id, AllowedOrigins: [origin], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['content-type', 'x-amz-*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }
  if (rules.some(r => r.ID === id && JSON.stringify(r.AllowedOrigins) === JSON.stringify(rule.AllowedOrigins) && r.ExposeHeaders?.includes('ETag') && r.AllowedMethods?.includes('PUT'))) return
  await s.client.send(new PutBucketCorsCommand({ Bucket: s.bucket, CORSConfiguration: { CORSRules: [...rules.filter(r => r.ID !== id), rule] } }))
}
export async function handleLibraryRequest(request: Request, action: string) {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const url = new URL(request.url), method = request.method
    const body = method === 'GET' ? {} : await request.json() as Record<string, unknown>
    const origin = url.origin
    if (action === 'config' && method === 'GET') {
      const auth = await requireAuthSession()
      if (auth.response) return auth.response
      const { source } = workspaceLibraryConfig(request)
      return Response.json({ ok: true, configured: source !== 'none', source }, { headers })
    }
    if (action === 'pairing/redeem' && method === 'POST') {
      let a: Access
      try { a = openLibraryToken<Access>('pairing', String(body.token || '')) } catch { throw new LibraryError(400, 'QR inválido.') }
      if (!a.expiresAt || a.expiresAt <= Date.now()) throw new LibraryError(410, 'El QR venció. Generá uno nuevo en la PC.')
      if (a.origin !== origin) throw new LibraryError(403, 'El QR pertenece a otra dirección de Cursado.')
      const installationId = libraryId(body.installationId), s = storage(a.r2)
      const key = `${prefix(a.workspaceId)}pairings/${libraryId(a.pairingId)}.json`
      let record = await read<Pairing>(s, key)
      if (record.value.expiresAt !== a.expiresAt || record.value.deviceId !== a.deviceId) throw new LibraryError(403, 'QR rechazado.')
      if (!record.value.installationId) {
        const name = String(body.name || 'InScreen Android').slice(0, 100)
        try { await write(s, key, { ...record.value, installationId, name }, { IfMatch: record.etag }) }
        catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error }
        record = await read<Pairing>(s, key)
      }
      if (record.value.installationId !== installationId) throw new LibraryError(409, 'Este QR ya fue usado por otro dispositivo.')
      const deviceKey = `${prefix(a.workspaceId)}devices/${a.deviceId}.json`
      try {
        const existing = (await read<Device>(s, deviceKey)).value
        if (!existing.enabled || existing.installationId !== installationId) throw new LibraryError(403, 'Dispositivo desvinculado.')
      } catch (error) {
        if (!missing(error)) throw error
        try { await write(s, deviceKey, { deviceId: a.deviceId, installationId, name: record.value.name || 'InScreen Android', enabled: true, createdAt: new Date().toISOString() } satisfies Device, { IfNoneMatch: '*' }) }
        catch (err) { if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw err }
      }
      const current = await manifest(s, a.workspaceId)
      return Response.json({ ok: true, baseUrl: origin, workspaceId: a.workspaceId, name: current?.value.name || 'Cursado', token: sealLibraryToken('device', { workspaceId: a.workspaceId, deviceId: a.deviceId, r2: a.r2, origin } satisfies Access) }, { headers })
    }
    if (['manifest', 'download'].includes(action) && method === 'GET') {
      const { access: a, s } = await deviceAccess(request), current = await manifest(s, a.workspaceId)
      if (!current) throw new LibraryError(404, 'La PC todavía no publicó esta biblioteca.')
      if (action === 'manifest') return Response.json({ ok: true, manifest: current.value }, { headers })
      const id = libraryHash(url.searchParams.get('id')), revision = libraryId(url.searchParams.get('revision'))
      // Permit finishing an earlier revision while a newer one is being published.
      const inventory = revision === current.value.revision ? current.value : (await read<LibraryManifest>(s, `${prefix(a.workspaceId)}revisions/${revision}.json`)).value
      const file = inventory.files.find(f => f.id === id)
      if (!file) throw new LibraryError(404, 'Archivo no disponible.')
      const downloadUrl = await getSignedUrl(s.client, new GetObjectCommand({ Bucket: s.bucket, Key: blobKey(a.workspaceId, file.hash) }), { expiresIn: 120 })
      return Response.json({ ok: true, url: downloadUrl }, { headers })
    }
    const a = await ownerAccess(request, String(body.workspaceId || url.searchParams.get('workspaceId') || '')), s = storage(a.r2)
    if (action === 'status' && method === 'GET') return Response.json({ ok: true, manifest: (await manifest(s, a.workspaceId))?.value || null }, { headers })
    if (action === 'cors' && method === 'POST') {
      try { await setupCors(s, origin); return Response.json({ ok: true, corsManaged: true }, { headers }) }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 403) throw error
        // Object-scoped keys can transfer files but cannot manage bucket CORS.
        return Response.json({ ok: true, corsManaged: false }, { headers })
      }
    }
    if (action === 'pairing/create' && method === 'POST') {
      if (!origin.startsWith('https://')) throw new LibraryError(400, 'La vinculación requiere Cursado desplegado por HTTPS.')
      if (!await manifest(s, a.workspaceId)) throw new LibraryError(409, 'Completá la primera publicación antes de vincular.')
      const pairingId = randomUUID(), deviceId = randomUUID(), expiresAt = Date.now() + 300000
      await write(s, `${prefix(a.workspaceId)}pairings/${pairingId}.json`, { deviceId, expiresAt, installationId: null } satisfies Pairing, { IfNoneMatch: '*' })
      const token = sealLibraryToken('pairing', { ...a, pairingId, deviceId, expiresAt, origin } satisfies Access)
      return Response.json({ ok: true, pairingUri: `inscreen://workspace-pair?${new URLSearchParams({ base_url: origin, token })}`, expiresAt }, { headers })
    }
    if (action === 'devices' && method === 'GET') {
      const devices: Device[] = []; let continuation: string | undefined
      do {
        const page = await s.client.send(new ListObjectsV2Command({ Bucket: s.bucket, Prefix: `${prefix(a.workspaceId)}devices/`, ContinuationToken: continuation }))
        for (const object of page.Contents || []) if (object.Key) devices.push((await read<Device>(s, object.Key)).value)
        continuation = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (continuation)
      return Response.json({ ok: true, devices }, { headers })
    }
    if (action === 'devices/revoke' && method === 'POST') {
      const key = `${prefix(a.workspaceId)}devices/${libraryId(body.deviceId)}.json`, device = await read<Device>(s, key)
      await write(s, key, { ...device.value, enabled: false, revokedAt: new Date().toISOString() }, { IfMatch: device.etag })
      return Response.json({ ok: true }, { headers })
    }
    if (action === 'upload' && method === 'POST') {
      const hash = libraryHash(body.hash), size = Number(body.size), mime = String(body.mime || 'application/octet-stream')
      if (!Number.isSafeInteger(size) || size < 0 || size > 20 * 1024 ** 3 || mime.length > 160) throw new LibraryError(400, 'Archivo inválido.')
      const key = blobKey(a.workspaceId, hash)
      try {
        const head = await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: key }))
        if (head.ContentLength === size && head.Metadata?.sha256 === hash) return Response.json({ ok: true, exists: true }, { headers })
      } catch (error) { if (!missing(error)) throw error }
      if (size <= 16 * 1024 ** 2) {
        const uploadUrl = await getSignedUrl(s.client, new PutObjectCommand({ Bucket: s.bucket, Key: key, ContentType: mime, ContentLength: size, Metadata: { sha256: hash } }), { expiresIn: 900 })
        return Response.json({ ok: true, uploadUrl, headers: { 'Content-Type': mime, 'x-amz-meta-sha256': hash } }, { headers })
      }
      const multipart = await s.client.send(new CreateMultipartUploadCommand({ Bucket: s.bucket, Key: key, ContentType: mime, Metadata: { sha256: hash } }))
      const partSize = Math.max(8 * 1024 ** 2, Math.ceil(size / 9000)), partCount = Math.ceil(size / partSize)
      const session = sealLibraryToken('upload', { workspaceId: a.workspaceId, hash, size, uploadId: multipart.UploadId, partCount, expiresAt: Date.now() + 24 * 3600000 })
      return Response.json({ ok: true, session, partSize, partCount }, { headers })
    }
    if (action.startsWith('upload/') && method === 'POST') {
      const u = openLibraryToken<{ workspaceId: string; hash: string; size: number; uploadId: string; partCount: number; expiresAt: number }>('upload', String(body.session || ''))
      if (u.workspaceId !== a.workspaceId || u.expiresAt < Date.now()) throw new LibraryError(403, 'Transferencia vencida.')
      const params = { Bucket: s.bucket, Key: blobKey(a.workspaceId, u.hash), UploadId: u.uploadId }
      if (action === 'upload/part') {
        const part = Number(body.part)
        if (!Number.isInteger(part) || part < 1 || part > u.partCount) throw new LibraryError(400, 'Parte inválida.')
        return Response.json({ ok: true, url: await getSignedUrl(s.client, new UploadPartCommand({ ...params, PartNumber: part }), { expiresIn: 900 }) }, { headers })
      }
      if (action === 'upload/abort') await s.client.send(new AbortMultipartUploadCommand(params))
      else if (action === 'upload/complete') {
        const parts = body.parts as { ETag: string; PartNumber: number }[]
        if (!Array.isArray(parts) || parts.length !== u.partCount || parts.some((p, i) => p.PartNumber !== i + 1 || typeof p.ETag !== 'string')) throw new LibraryError(400, 'Partes incompletas.')
        await s.client.send(new CompleteMultipartUploadCommand({ ...params, MultipartUpload: { Parts: parts } }))
      } else throw new LibraryError(404, 'Ruta desconocida.')
      return Response.json({ ok: true }, { headers })
    }
    if (action === 'publish' && method === 'POST') {
      const m = validateLibraryManifest(body.manifest)
      if (m.workspaceId !== a.workspaceId) throw new LibraryError(403, 'Espacio incompatible.')
      const current = await manifest(s, a.workspaceId)
      if ((current?.value.revision || null) !== (body.previousRevision || null)) throw new LibraryError(409, 'Otra publicación terminó primero. Reintentá.')
      for (let i = 0; i < m.files.length; i += 12) await Promise.all(m.files.slice(i, i + 12).map(async f => {
        const head = await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: blobKey(a.workspaceId, f.hash) }))
        if (head.ContentLength !== f.size || head.Metadata?.sha256 !== f.hash) throw new LibraryError(409, `Falta completar ${f.path}.`)
      }))
      await write(s, `${prefix(a.workspaceId)}revisions/${m.revision}.json`, m, { IfNoneMatch: '*' })
      await write(s, `${prefix(a.workspaceId)}current.json`, m, current ? { IfMatch: current.etag } : { IfNoneMatch: '*' })
      return Response.json({ ok: true, revision: m.revision }, { headers })
    }
    throw new LibraryError(404, 'Ruta desconocida.')
  } catch (error) {
    const status = error instanceof LibraryError ? error.status : (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412 ? 409 : 400
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'No se pudo actualizar la biblioteca.' }, { status, headers })
  }
}
