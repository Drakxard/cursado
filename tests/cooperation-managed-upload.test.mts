import assert from 'node:assert/strict'
import test from 'node:test'
import { authRuntime } from './cloudflare-runtime.mjs'

test('cooperative members upload without personal R2 keys using expiring single-use tickets bound to exact files', async t => {
  const backend = authRuntime(); t.after(() => backend.close())
  const actors = []
  for (const name of ['OwnerUpload', 'MemberUpload', 'StrangerUpload']) {
    const response = await backend.request('/api/auth/guest', { body: { name, password: 'test-only' } })
    actors.push({ name, cookie: response.headers.get('set-cookie')!.split(';')[0] })
  }
  const [owner, member, stranger] = actors
  const api = (actor, path, body) => backend.request(`/api/cooperation/${path}`, { cookie: actor.cookie, body })
  const group = await (await api(owner, 'groups', { names: member.name })).json()
  const sphere = await (await api(owner, 'spheres', { groupId: group.id, name: 'Shared', color: '#123456' })).json()
  const bytes = new TextEncoder().encode('participant file'), hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
  const path = `spheres/${sphere.id}/files/${hash}`
  assert.equal((await api(member, path, { size: bytes.length })).status, 403)
  await api(member, `spheres/${sphere.id}/accept`, {})
  assert.equal((await api(stranger, path, { size: bytes.length })).status, 403)
  const prepare = async (size = bytes.length) => (await api(member, path, { size, mime: 'application/pdf' })).json()
  const put = (session, body = bytes, origin = backend.env.CURSADO_ORIGIN, url = session.uploadUrl) => backend.fetch(new Request(url, { method: 'PUT', headers: { Origin: origin, ...session.headers }, body }))
  const session = await prepare()
  assert.ok(session.uploadUrl)
  assert.equal((await put(session, bytes, 'https://foreign.test')).status, 403)
  const altered = new URL(session.uploadUrl); altered.pathname = altered.pathname.replace(hash, '0'.repeat(64))
  assert.equal((await put(session, bytes, backend.env.CURSADO_ORIGIN, altered.href)).status, 403)
  const badSize = await prepare(bytes.length + 1)
  assert.equal((await put(badSize)).status, 422)
  assert.equal((await put(badSize)).status, 403)
  const oversized = await prepare(bytes.length - 1)
  assert.equal((await put(oversized)).status, 422)
  const corrupted = await prepare()
  assert.equal((await put(corrupted, new Uint8Array(bytes.length))).status, 422)
  const uploaded = await put(session)
  assert.equal(uploaded.status, 200)
  assert.equal(uploaded.headers.get('access-control-allow-origin'), backend.env.CURSADO_ORIGIN)
  assert.equal((await put(session)).status, 403)
  assert.equal((await prepare()).exists, true)
  const nextHash = '1'.repeat(64)
  const expired = await (await api(member, `spheres/${sphere.id}/files/${nextHash}`, { size: bytes.length, mime: 'application/pdf' })).json()
  backend.rooms.get(sphere.id).instance.sql.exec('UPDATE upload_tickets SET expires=?', Date.now() - 1)
  assert.equal((await put(expired)).status, 403)
})
