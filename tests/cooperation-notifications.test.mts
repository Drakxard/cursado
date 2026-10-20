import assert from 'node:assert/strict'
import test from 'node:test'
import { authRuntime } from './cloudflare-runtime.mjs'

test('directory notifications reach only group members and ordinary edits use the sphere channel', async t => {
  const backend = authRuntime(); t.after(() => backend.close())
  const actors = []
  for (const name of ['NoticeA', 'NoticeB', 'NoticeOther']) {
    const response = await backend.request('/api/auth/guest', { body: { name, password: 'test-only' } })
    const user = await response.json(), cookie = response.headers.get('set-cookie')!.split(';')[0]
    const ticket = await backend.request('/api/cooperation/notifications/ticket', { cookie, body: {} })
    assert.equal(ticket.status, 200)
    assert.match((await ticket.json()).url, new RegExp(`/notifications/socket/${user.id}\\?ticket=`))
    const messages: any[] = [], room = backend.rooms.get(`notifications:${user.id}`)
    room.context.getWebSockets = () => [{ send: raw => messages.push(JSON.parse(raw)) }]
    actors.push({ name, user, cookie, messages })
  }
  const [a, b, other] = actors
  const api = (path, body) => backend.request(`/api/cooperation/${path}`, { cookie: a.cookie, body })
  const group = await (await api('groups', { names: b.name })).json()
  assert.equal(a.messages.length, 1); assert.equal(b.messages.length, 1); assert.equal(other.messages.length, 0)
  const sphere = await (await api('spheres', { groupId: group.id, name: 'Shared', color: '#123456' })).json()
  assert.equal(b.messages.length, 2)
  await api(`spheres/${sphere.id}/operations`, { id: 'metadata', changes: [{ key: 'sphere.json', type: 'json', value: { name: 'Shared', color: '#123456' } }] })
  assert.equal(b.messages.length, 3)
  await api(`spheres/${sphere.id}/operations`, { id: 'content', changes: [{ key: 'manifests/materials/math/week-1.json', type: 'json', value: { materials: [] } }] })
  assert.equal(b.messages.length, 3)
  assert.equal(b.messages[2].type, 'directory_changed')
  assert.equal(other.messages.length, 0)
  const denied = await backend.request('/api/cooperation/notifications/ticket', { body: {} })
  assert.equal(denied.status, 401)
})
