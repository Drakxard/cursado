import { PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export function createR2S3Client(config: S3ClientConfig) {
  // A presigned upload has no body yet. The SDK's automatic CRC32 otherwise
  // signs the checksum of an empty body, which rejects the later browser PUT.
  return new S3Client({ ...config, requestChecksumCalculation: 'WHEN_REQUIRED' })
}

export function createR2UploadUrl(client: S3Client, input: { Bucket: string; Key: string; ContentType: string; Metadata?: Record<string, string> }, expiresIn = 900) {
  return getSignedUrl(client, new PutObjectCommand(input), { expiresIn, unhoistableHeaders: new Set(Object.keys(input.Metadata || {}).map(key => `x-amz-meta-${key}`)), signableHeaders: new Set(['content-type']) })
}
