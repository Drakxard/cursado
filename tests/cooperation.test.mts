import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeCooperation, parseCooperationNames, safeCooperationPath, type Json } from '../lib/cooperation-model.ts'
import { authRuntime } from './cloudflare-runtime.mjs'

test('cooperative names, paths, independent changes, concurrent canvas edits and deletion precedence', () => {
  assert.deepEqual(parseCooperationNames('[PersonaA, PersonaB]'), ['PersonaA', 'PersonaB'])
  assert.throws(() => parseCooperationNames('A, a'))
  assert.throws(() => parseCooperationNames('[]'))
  for (const path of ['../User.Services', 'a/../../x', '/absolute', 'a\\b', 'a/__proto__/x']) assert.equal(safeCooperationPath(path), false)
  const base = { strokes: [{ id: 'one', x: 0, width: 100, color: 'red' }], texts: [] }
  const a = { ...base, texts: [{ id: 'a', text: 'A' }] }, b = { ...base, texts: [{ id: 'b', text: 'B' }] }
  assert.equal(((mergeCooperation(base, a, b) as typeof a).texts).length, 2)
  const conflicts = []
  const merged = mergeCooperation(base, { ...base, strokes: [{ ...base.strokes[0], x: 10 }] }, { ...base, strokes: [{ ...base.strokes[0], x: 20 }] }, conflicts) as typeof base
  assert.equal(merged.strokes.length, 2); assert.ok(conflicts.length)
  assert.equal((mergeCooperation(base, a, { ...base, strokes: [] }) as typeof base).strokes.length, 0)
  const heading = (id: string) => ({ type: 'heading', attrs: { synthesisId: id, level: 1 } })
  const document = { type: 'doc', content: [heading('a'), { type: 'paragraph', text: 'A' }, heading('b'), { type: 'paragraph', text: 'B' }] }
  const ours = structuredClone(document), theirs = structuredClone(document)
  ours.content[1].text = 'Changed A'; theirs.content[3].text = 'Changed B'
  const result = mergeCooperation(document, ours, theirs) as typeof document
  assert.equal(result.content[1].text, 'Changed A'); assert.equal(result.content[3].text, 'Changed B')
})

async function register(backend, name) {
  const response = await backend.request('/api/auth/guest', { body: { name, password: 'testing-cooperation' } })
  assert.equal(response.status, 200)
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: await response.json() }
}

test('one source shared concurrently with two groups keeps the same publication and R2 namespace', async t => {
  const backend = authRuntime(); t.after(() => backend.close())
  const a = await register(backend, 'Publisher'), b = await register(backend, 'GroupX'), c = await register(backend, 'GroupY')
  const api = (actor, path, body?) => backend.request(`/api/cooperation/${path}`, { cookie: actor.cookie, ...(body === undefined ? {} : { body }) })
  const x = await (await api(a, 'groups', { names: 'GroupX' })).json(), y = await (await api(a, 'groups', { names: 'GroupY' })).json()
  const source = { name: 'Prog 3', color: '#ff6600', sourceId: 'prog3', sourceKey: 'Prog3' }
  const [first, second] = await Promise.all([api(a, 'spheres', { ...source, groupId: x.id }), api(a, 'spheres', { ...source, groupId: y.id })])
  const published = await first.json(), linked = await second.json()
  assert.equal(published.id, linked.id)
  const directory = await (await api(a, 'groups')).json()
  assert.equal(new Set(directory.groups.flatMap(group => group.spheres).map(sphere => sphere.id)).size, 1)
  const before = await (await api(a, `spheres/${published.id}/snapshot`)).json()
  assert.equal((await (await api(a, 'spheres', { ...source, groupId: y.id })).json()).id, published.id)
  assert.deepEqual(await (await api(a, `spheres/${published.id}/snapshot`)).json(), before)
  const different = await (await api(a, 'spheres', { ...source, sourceId: 'other-course', sourceKey: 'OtherCourse', groupId: x.id })).json()
  assert.notEqual(different.id, published.id, 'the display name cannot merge unrelated courses')
  await api(c, `groups/${y.id}/accept`, {})
  const otherOwner = await (await api(c, 'spheres', { ...source, groupId: y.id })).json()
  assert.notEqual(otherOwner.id, published.id, 'origin identities are scoped to their publisher')
  assert.equal((await api(b, 'spheres', { ...source, groupId: y.id, sphereId: published.id })).status, 403)
})
test('three participants, invitations, isolation, durable operation deduplication, offline merges and verified files', async t => {
  const backend = authRuntime(); t.after(() => backend.close())
  const a = await register(backend, 'PersonaA'), b = await register(backend, 'PersonaB'), c = await register(backend, 'PersonaC'), stranger = await register(backend, 'Extra')
  const request = (actor, path, body?) => backend.request(`/api/cooperation/${path}`, { cookie: actor.cookie, ...(body === undefined ? {} : { body }) })
  for (const names of ['PersonaA', 'PersonaB, PersonaB', 'NoExiste']) assert.equal((await request(a, 'groups', { names })).status, 422)
  const groupResponse = await request(a, 'groups', { names: '[PersonaB, PersonaC]' })
  assert.equal(groupResponse.status, 201)
  const { id: groupId } = await groupResponse.json()
  assert.equal((await (await request(a, 'groups', { names: 'PersonaC, PersonaB' })).json()).id, groupId)
  const sphere = await (await request(a, 'spheres', { groupId, name: 'Álgebra', color: '#2563eb' })).json()
  const pendingGroups = await (await request(b, 'groups')).json()
  assert.equal(pendingGroups.groups[0].spheres[0].id, sphere.id)
  assert.equal(pendingGroups.groups[0].spheres[0].ready, false)
  const room = backend.env.CONTENT_ROOMS.getByName(sphere.id)
  for (const code of [1005, 1006, 1015]) {
    let replyCode = 0
    room.webSocketClose({ close(value) { replyCode = value } }, code)
    assert.equal(replyCode, 1000)
  }
  assert.equal((await request(b, `spheres/${sphere.id}/snapshot`)).status, 403)
  assert.equal((await request(stranger, `spheres/${sphere.id}/snapshot`)).status, 403)
  for (const actor of [b, c]) assert.equal((await request(actor, `spheres/${sphere.id}/accept`, {})).status, 200)
  const key = 'manifests/materials/algebra/week-1.json'
  const initial: Json = { materials: [{ id: 1, file_name: 'Uno.pdf' }] }
  const first = { id: 'initial', changes: [{ key, type: 'json', value: initial }] }
  assert.equal((await request(a, `spheres/${sphere.id}/operations`, first)).status, 200)
  await request(a, `spheres/${sphere.id}/operations`, first)
  assert.equal((await (await request(b, `spheres/${sphere.id}/snapshot`)).json()).seq, 1)
  await request(a, `spheres/${sphere.id}/operations`, { id: 'a-add', changes: [{ key, type: 'json', base: initial, value: { materials: [...initial.materials, { id: 2, file_name: 'Dos.pdf' }] } }] })
  await request(b, `spheres/${sphere.id}/operations`, { id: 'b-add-offline', changes: [{ key, type: 'json', base: initial, value: { materials: [...initial.materials, { id: 3, file_name: 'Tres.pdf' }] } }] })
  const state = await (await request(c, `spheres/${sphere.id}/snapshot`)).json()
  assert.equal(state.resources[key].value.materials.length, 3)
  backend.restart()
  assert.deepEqual(await (await request(c, `spheres/${sphere.id}/snapshot`)).json(), state)
  const data = new TextEncoder().encode('verified PDF bytes'), fingerprint = Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex')
  const url = `https://backend.test/api/cooperation/spheres/${sphere.id}/files/${fingerprint}`
  assert.equal((await request(stranger, `spheres/${sphere.id}/files/${fingerprint}`, { size: data.length })).status, 403)
  assert.equal((await request(a, `spheres/${sphere.id}/files/${fingerprint}`, { size: 101 * 1024 * 1024 })).status, 422)
  const direct = await (await request(a, `spheres/${sphere.id}/files/${fingerprint}`, { size: data.length })).json()
  assert.equal(direct.objectKey, `cursado/shared/${sphere.id}/${fingerprint}`)
  assert.equal(direct.bucket, 'estudiodiario')
  const upload = body => backend.fetch(new Request(url, { method: 'PUT', headers: { Origin: backend.env.CURSADO_ORIGIN, Cookie: a.cookie, 'Content-Type': 'application/pdf' }, body }))
  assert.equal((await upload(new Uint8Array([1]))).status, 422)
  assert.equal((await upload(data)).status, 200)
  assert.equal((await (await request(a, `spheres/${sphere.id}/files/${fingerprint}`, { size: data.length })).json()).exists, true)
  assert.equal((await (await request(a, `spheres/${sphere.id}/files/${fingerprint}`, { size: data.length + 1 })).json()).exists, false)
  const blob = { hash: fingerprint, size: data.length, mime: 'application/pdf' }
  await request(a, `spheres/${sphere.id}/operations`, { id: 'file', changes: [{ key: 'teoria/algebra/one.pdf', type: 'blob', blob }] })
  assert.deepEqual(new Uint8Array(await (await backend.fetch(new Request(url, { headers: { Cookie: c.cookie } }))).arrayBuffer()), data)
  assert.equal((await backend.fetch(new Request(url, { headers: { Cookie: stranger.cookie } }))).status, 403)
  const ticket = await (await request(a, `spheres/${sphere.id}/ticket`, {})).json()
  assert.match(ticket.url, /^wss:\/\/backend.test\/api\/cooperation\/socket\//)
  await request(a, `spheres/${sphere.id}/operations`, { id: 'delete', changes: [{ key, type: 'delete' }] })
  await request(b, `spheres/${sphere.id}/operations`, { id: 'stale', changes: [{ key, type: 'json', value: initial }] })
  assert.equal((await (await request(c, `spheres/${sphere.id}/snapshot`)).json()).resources[key].deleted, true)
  assert.equal((await request(a, `spheres/${sphere.id}/operations`, { id: 'path', changes: [{ key: '../User.Services', type: 'json', value: {} }] })).status, 422)
  await request(a, `spheres/${sphere.id}/operations`, { id: 'metadata', changes: [{ key: 'sphere.json', type: 'json', value: { subjectId: 'algebra', storageKey: 'algebra', name: 'Álgebra' } }] })
  assert.equal((await (await request(b, 'groups')).json()).groups[0].spheres[0].ready, true)
  await request(a, `spheres/${sphere.id}/operations`, { id: 'delete-sphere', changes: [{ key: 'sphere.json', type: 'delete' }] })
  assert.equal((await (await request(b, 'groups')).json()).groups[0].spheres.length, 0)
})
