import { CopyObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createR2S3Client } from './r2-client.ts'
import { getInscreenRuntimeSecret } from './inscreen-user-config.ts'

export async function createCooperationR2UploadSession(input: { objectKey: string; bucket: string; hash: string; size: number; mime: string; workspaceId?: string }) {
  const secret = (key: 'R2_ENDPOINT' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET_NAME') => getInscreenRuntimeSecret(key) || process.env[key]
  const R2_ENDPOINT = secret('R2_ENDPOINT'), R2_ACCESS_KEY_ID = secret('R2_ACCESS_KEY_ID'), R2_SECRET_ACCESS_KEY = secret('R2_SECRET_ACCESS_KEY'), R2_BUCKET_NAME = secret('R2_BUCKET_NAME')
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || R2_BUCKET_NAME !== input.bucket) throw new Error('Falta configurar R2 para el bucket cooperativo.')
  const client = createR2S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } })
  try {
    if (input.workspaceId && /^[a-zA-Z0-9_-]{16,100}$/.test(input.workspaceId)) {
      const key = `manifests/workspace-library/${input.workspaceId}/blobs/${input.hash}`
      try {
        const source = await client.send(new GetObjectCommand({ Bucket: input.bucket, Key: key }))
        if (source.ContentLength === input.size && source.Body && source.ETag) {
          const digest = createHash('sha256'), reader = source.Body.transformToWebStream().getReader()
          let size = 0
          try {
            while (true) {
              const part = await reader.read()
              if (part.done) break
              size += part.value.byteLength
              if (size > input.size) { await reader.cancel(); break }
              digest.update(part.value)
            }
          } finally { reader.releaseLock() }
          if (size === input.size && digest.digest('hex') === input.hash) {
            await client.send(new CopyObjectCommand({ Bucket: input.bucket, Key: input.objectKey, CopySource: `${input.bucket}/${key}`, CopySourceIfMatch: source.ETag, MetadataDirective: 'REPLACE', ContentType: input.mime, Metadata: { sha256: input.hash } }))
            return { exists: true }
          }
        } else if (source.Body) await source.Body.transformToWebStream().cancel()
      } catch (error) {
        // A missing or concurrently replaced backup falls back to a direct upload.
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        if (![404, 412].includes(status || 0) && (error as { name?: string }).name !== 'NoSuchKey') throw error
      }
    }
    const checksum = Buffer.from(input.hash, 'hex').toString('base64')
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
      Bucket: input.bucket, Key: input.objectKey, ContentType: input.mime,
      ContentLength: input.size, ChecksumSHA256: checksum,
    }), { expiresIn: 900, unhoistableHeaders: new Set(['x-amz-checksum-sha256']), signableHeaders: new Set(['content-type', 'content-length']) })
    return { uploadUrl, headers: { 'Content-Type': input.mime, 'x-amz-checksum-sha256': checksum } }
  } finally { client.destroy() }
}
