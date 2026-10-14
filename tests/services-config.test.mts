import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeInscreenUserConfig, sealInscreenUserConfig, openInscreenUserConfig, withInscreenRuntimeConfig, withOptionalServicesConfig, getInscreenRuntimeSecret } from '../lib/inscreen-user-config.ts'
import { azureConnectionString, azureStorage } from '../lib/server/azure-storage.ts'
import { azureExplanationConfig } from '../lib/server/pdf-explanation-azure.ts'
import { getClefConfiguration } from '../lib/server/cloudflare-clef.ts'
import { getDatalabMarkerApiKey } from '../lib/datalab-marker.ts'
import { servicesStatus } from '../lib/services-config.ts'

const connection = `DefaultEndpointsProtocol=https;AccountName=cursadotest;AccountKey=${Buffer.alloc(32, 1).toString('base64')};EndpointSuffix=core.windows.net`
const supplied = {
  storage_azure: connection, gpt5mini: 'azure-test-key', conexiongpt5mini: 'https://test.openai.azure.com',
  AZURE_OPENAI_DEPLOYMENT: 'study-mini', gatewayia: 'gateway-test-key', datalab: 'datalab-test-key',
  cloudflareapi: 'cloudflare-test-key', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
}

test('all requested credentials remain encrypted, authenticate their envelope, and older tokens keep their shape', () => {
  const previous = process.env.INSCREEN_CONFIG_SEED
  try {
    process.env.INSCREEN_CONFIG_SEED = 'test-seed-with-more-than-thirty-two-characters'
    const config = normalizeInscreenUserConfig(supplied)
    const token = sealInscreenUserConfig(config)
    assert.ok(token.length < 12_000)
    assert.doesNotMatch(token, /azure-test-key|gateway-test-key|datalab-test-key|cloudflare-test-key|DefaultEndpointsProtocol/)
    assert.deepEqual(openInscreenUserConfig(token), config)
    const parts = token.split('.')
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1)
    assert.throws(() => openInscreenUserConfig(parts.join('.')), /desbloquear/)
    assert.throws(() => openInscreenUserConfig(token + '.extra'), /invalida/)
    const legacy = normalizeInscreenUserConfig({ GROQ_API_KEY: 'legacy-key' })
    assert.deepEqual(openInscreenUserConfig(sealInscreenUserConfig(legacy)), legacy)
    assert.equal('storage_azure' in legacy, false)
    process.env.INSCREEN_CONFIG_SEED = 'different-test-seed-with-thirty-two-characters'
    assert.throws(() => openInscreenUserConfig(token), /desbloquear/)
  } finally { if (previous === undefined) delete process.env.INSCREEN_CONFIG_SEED; else process.env.INSCREEN_CONFIG_SEED = previous }
})

test('invalid provider groups or credential destinations fail before a file can be saved', () => {
  for (const config of [
    { gpt5mini: 'key' }, { gpt5mini: 'key', conexiongpt5mini: 'https://unrelated.example.com' },
    { gpt5mini: 'key', conexiongpt5mini: 'https://test.openai.azure.com:9999' },
    { cloudflareapi: 'key' }, { cloudflareapi: 'key', CLOUDFLARE_ACCOUNT_ID: 'wrong' },
    { storage_azure: 'UseDevelopmentStorage=true' },
    { storage_azure: connection.replace('https', 'http') },
    { storage_azure: connection.replace('cursadotest', 'bad@account') },
    { storage_azure: connection + ';BlobEndpoint=https://unrelated.example.com/' },
    { gatewayia: 'x'.repeat(4097) }, { gatewayia: ['key'] },
  ]) assert.throws(() => normalizeInscreenUserConfig(config))
  const status = servicesStatus(normalizeInscreenUserConfig(supplied))
  for (const name of ['azureStorage', 'azureGpt', 'gateway', 'datalab', 'cloudflareVoice'] as const) assert.equal(status[name], true)
  assert.ok(Object.values(status).every(value => typeof value === 'boolean'))
})

test('concurrent requests use their own saved keys and never change deployment environment variables', async () => {
  const env = process.env.gatewayia
  process.env.gatewayia = 'deployment-key'
  try {
    const snapshots = await Promise.all(['first', 'second'].map((key, index) => withInscreenRuntimeConfig(normalizeInscreenUserConfig({ ...supplied, gatewayia: key }), async () => {
      await new Promise(resolve => setTimeout(resolve, index ? 3 : 20))
      assert.equal(azureConnectionString(), connection)
      assert.equal(azureStorage().container.containerName, 'cursado2026')
      assert.equal(azureExplanationConfig()?.apiKey, supplied.gpt5mini)
      assert.equal(azureExplanationConfig()?.deployment, 'study-mini')
      assert.equal(getClefConfiguration().token, supplied.cloudflareapi)
      assert.equal(getClefConfiguration().accountId, supplied.CLOUDFLARE_ACCOUNT_ID)
      assert.equal(getDatalabMarkerApiKey(), supplied.datalab)
      return getInscreenRuntimeSecret('gatewayia')
    })))
    assert.deepEqual(snapshots, ['first', 'second'])
    assert.equal(getInscreenRuntimeSecret('gatewayia'), '')
    assert.equal(process.env.gatewayia, 'deployment-key')
  } finally { if (env === undefined) delete process.env.gatewayia; else process.env.gatewayia = env }
})

test('a corrupt supplied token blocks the provider call; requests without a file keep deployment compatibility', async () => {
  let calls = 0
  const handler = async () => { calls++; return Response.json({ ok: true }) }
  const invalid = await withOptionalServicesConfig(new Request('https://study.test', { headers: { 'x-inscreen-config-token': 'invalid' } }), handler)
  assert.equal(invalid.status, 428)
  assert.equal(calls, 0)
  assert.equal((await withOptionalServicesConfig(new Request('https://study.test'), handler)).status, 200)
  assert.equal(calls, 1)
})
