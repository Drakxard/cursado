import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

test('real SDK browser signatures do not sign an empty CRC32 or duplicate metadata in query and headers', async () => {
  const result = await build({ entryPoints: ['lib/r2-client.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const { createR2S3Client, createR2UploadUrl } = module.exports
  const require = createRequire(import.meta.url)
  const client = createR2S3Client({ region: 'auto', endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' } })
  try {
    for (const metadata of [{ sha256: 'b'.repeat(64) }, { 'subject-id': 'calculo2', 'original-file-name': 'apunte.pdf' }]) {
      const url = new URL(await createR2UploadUrl(client, { Bucket: 'fixture', Key: 'r2/calculo/semana-1/lunes/apunte.pdf', ContentType: 'application/pdf', Metadata: metadata }))
      const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';')
      assert.equal(url.searchParams.has('x-amz-checksum-crc32'), false)
      assert.equal(url.searchParams.has('x-amz-sdk-checksum-algorithm'), false)
      assert.equal(signed.includes('content-length'), false)
      assert.equal(signed.includes('content-type'), true)
      for (const key of Object.keys(metadata)) {
        assert.equal(signed.includes(`x-amz-meta-${key}`), true)
        assert.equal(url.searchParams.has(`x-amz-meta-${key}`), false)
      }
    }
    const part = new URL(await require('@aws-sdk/s3-request-presigner').getSignedUrl(client, new (require('@aws-sdk/client-s3').UploadPartCommand)({ Bucket: 'fixture', Key: 'large.pdf', UploadId: 'fixture-session', PartNumber: 1 }), { expiresIn: 900 }))
    assert.equal(part.searchParams.has('x-amz-checksum-crc32'), false)
  } finally { client.destroy() }
})
