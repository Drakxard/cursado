import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createR2S3Client } from './r2-client.ts'

export async function createCooperationR2UploadSession(input: { objectKey: string; bucket: string; hash: string; size: number; mime: string }) {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || R2_BUCKET_NAME !== input.bucket) throw new Error('Falta configurar R2 para el bucket cooperativo.')
  const client = createR2S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } })
  const checksum = Buffer.from(input.hash, 'hex').toString('base64')
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
    Bucket: input.bucket, Key: input.objectKey, ContentType: input.mime,
    ContentLength: input.size, ChecksumSHA256: checksum,
  }), { expiresIn: 900, unhoistableHeaders: new Set(['x-amz-checksum-sha256']), signableHeaders: new Set(['content-type', 'content-length']) })
  return { uploadUrl, headers: { 'Content-Type': input.mime, 'x-amz-checksum-sha256': checksum } }
}
