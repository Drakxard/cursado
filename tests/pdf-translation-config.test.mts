import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { openInscreenUserConfig, sealInscreenUserConfig } from '../lib/inscreen-user-config.ts'

async function route(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'fixtures', setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/authz|groq-sdk)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'groq-sdk' ? `class AuthenticationError extends Error {}; export default class Groq { static AuthenticationError = AuthenticationError; constructor({apiKey}) { this.models = { list: async () => { if (apiKey === 'bad') throw new AuthenticationError(); return {data: []} } }; this.chat = { completions: { create: async () => ({ choices: [{ message: { content: 'Texto traducido' } }] }) } }; } }` : 'export async function requireAuthSession(){ return {response:null,session:{email:"test@example.com"}} }' }))
  } }] })
  const mod = { exports: {} as { POST: (request: Request) => Promise<Response> } }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports)
  return mod.exports.POST
}

test('translation requires its own token, ignores star credentials and returns text with its separate key', async () => {
  process.env.INSCREEN_CONFIG_SEED = 'test-translation-seed-at-least-thirty-two-characters'
  const post = await route('app/api/pdf-translate/route.ts')
  const token = sealInscreenUserConfig({ GROQ_API_KEY: 'translation-key' })
  const request = (headers: Record<string, string>) => new Request('https://example.test/api/pdf-translate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({text: 'Hello', promptTemplate: 'Traducir: {texto}'}) })
  const missing = await post(request({'x-inscreen-config-token': token}))
  assert.equal(missing.status, 428)
  assert.equal((await missing.json()).translationConfigurationRequired, true)
  const response = await post(request({'x-pdf-translation-token': token}))
  assert.deepEqual(await response.json(), {translation: 'Texto traducido'})
})

test('translation config validates and encrypts the key independently', async () => {
  process.env.INSCREEN_CONFIG_SEED = 'test-translation-seed-at-least-thirty-two-characters'
  const post = await route('app/api/pdf-translate/config/route.ts')
  const request = (apiKey: string) => new Request('https://example.test/api/pdf-translate/config', {method: 'POST', body: JSON.stringify({apiKey})})
  assert.equal((await post(request('bad'))).status, 400)
  const response = await post(request('translation-key'))
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const { token } = await response.json()
  assert.ok(!token.includes('translation-key'))
  assert.equal(openInscreenUserConfig(token).GROQ_API_KEY, 'translation-key')
})


test('Datalab key is sealed separately and overrides an unreadable services envelope for OCR', async t => {
  process.env.INSCREEN_CONFIG_SEED = 'test-datalab-seed-at-least-thirty-two-characters'
  const configure = await route('app/api/subject-voice/pdf-extraction/config/route.ts')
  const response = await configure(new Request('https://example.test/api/subject-voice/pdf-extraction/config', { method: 'POST', body: JSON.stringify({apiKey:'ocr-only-secret'}) }))
  assert.equal(response.status, 200)
  const {token} = await response.json()
  assert.equal(openInscreenUserConfig(token).datalab, 'ocr-only-secret')
  assert.ok(!token.includes('ocr-only-secret'))
  const extract = await route('app/api/subject-voice/pdf-extraction/route.ts')
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('X-API-Key'), 'ocr-only-secret')
    return Response.json({success:true,request_check_url:'https://www.datalab.to/api/v1/convert/job-1'})
  })
  const form = new FormData()
  form.set('file', new File(['%PDF-1.7'], 'sample.pdf', {type:'application/pdf'}))
  const submitted = await extract(new Request('https://example.test/api/subject-voice/pdf-extraction', {method:'POST', headers:{'x-inscreen-config-token':'unreadable-old-token','x-datalab-config-token':token}, body:form}))
  assert.equal(submitted.status, 200)
  assert.equal(typeof (await submitted.json()).token, 'string')
})
