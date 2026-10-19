import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundled = await build({ entryPoints: ['cloudflare/src/index.js'], bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'cloudflare-runtime', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'runtime', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export class DurableObject { constructor(ctx) { this.ctx=ctx } }' }))
  } }],
})
const { default: worker, SharedContentRoom } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

test('health verifies the SQLite and R2 bindings, caches success, and exposes no storage credentials', async () => {
  const previous = globalThis.caches
  let cacheKey = '', objectKey = '', roomName = '', roomChecks = 0
  const saved = new Map()
  globalThis.caches = { default: { match: async request => saved.get(request.url)?.clone(), put: async (request, response) => { cacheKey=request.url; saved.set(request.url,response) } } } as any
  const tasks: Promise<unknown>[] = []
  const execution = { waitUntil: task => tasks.push(task) }
  const room = new SharedContentRoom({ storage: { sql: { exec(query) { if(query.startsWith('CREATE TABLE'))return;assert.equal(query,'SELECT 1 AS ready'); roomChecks++; return { one: () => ({ ready: 1 }) } } } } })
  const env = { CONTENT_PREFIX: 'cursado/shared/', CONTENT_ROOMS: { getByName(name) { roomName=name; return room } }, CONTENT_FILES: { async head(key) { objectKey=key; return null } } }
  try {
    const response = await worker.fetch(new Request('https://backend.test/healthz'), env, execution)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, service: 'cursado-realtime', phase: 'cooperation', authenticationReady: false, collaborationReady: true, bindings: { durableObjects: true, sqlite: true, r2: true } })
    await Promise.all(tasks)
    assert.equal(roomName,'infrastructure-health')
    assert.equal(objectKey,'cursado/shared/infrastructure-health')
    assert.equal(cacheKey,'https://backend.test/health')
    assert.equal((await worker.fetch(new Request('https://backend.test/health'), env, execution)).status,200)
    assert.equal(roomChecks,1)
  } finally { globalThis.caches = previous }
})

test('a failed binding returns a generic uncached error; unimplemented API routes never pretend collaboration is ready', async () => {
  const previous = globalThis.caches
  let writes = 0
  globalThis.caches = { default: { match: async () => undefined, put: async () => { writes++ } } } as any
  try {
    const env = { CONTENT_ROOMS: { getByName() { throw new Error('sensitive internal details') } } }
    const response = await worker.fetch(new Request('https://backend.test/health'), env, { waitUntil() {} })
    assert.equal(response.status,503)
    assert.doesNotMatch(await response.text(),/sensitive/)
    assert.equal(writes,0)
    const pending = await worker.fetch(new Request('https://backend.test/api/boards/board/live-ticket'), {}, {})
    assert.equal(pending.status,501)
    assert.equal((await pending.json()).code,'COLLABORATION_NOT_IMPLEMENTED')
    const method = await worker.fetch(new Request('https://backend.test/health',{method:'POST'}), {}, {})
    assert.equal(method.status,405)
    assert.equal(method.headers.get('Allow'),'GET')
  } finally { globalThis.caches = previous }
})
