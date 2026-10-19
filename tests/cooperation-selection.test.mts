import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { projectSelectionTags, selectionResources } from '../lib/client/cooperation-selection.ts'

test('week exclusions follow PDFs, synthesis images, boards and shared dependencies; future weeks are included', async () => {
  const resources = Object.fromEntries([
    { key: 'sphere.json', type: 'json', value: { subjectId: 'math' } },
    { key: 'manifests/materials/math/week-1.json', type: 'json', value: { materials: [{ id: 1, file: 'workspace://teoria/math/one.pdf' }, { id: 3, file: 'workspace://teoria/math/shared.pdf' }] } },
    { key: 'manifests/materials/math/week-2.json', type: 'json', value: { materials: [{ id: 2, file: 'workspace://teoria/math/two.pdf' }, { id: 3, file: 'workspace://teoria/math/shared.pdf' }] } },
    { key: 'manifests/materials/math/week-3.json', type: 'json', value: { materials: [{ id: 4, file: 'workspace://teoria/math/new.pdf' }] } },
    ...['one', 'two', 'shared', 'new', 'orphan'].map(name => ({ key: `teoria/math/${name}.pdf`, type: 'blob', blob: { hash: name } })),
    { key: 'manifests/sintesis/math/semana-2/workspace.json', type: 'json', value: { image: 'synthesis-local-image:excluded' } },
    { key: 'sintesis/images/excluded.png', type: 'blob', blob: { hash: 'image' } },
    { key: 'progreso/pizarras/selected.json', type: 'json', value: { cooperationWeekNumber: 1, assets: { image: 'cooperation-asset:chosen' } } },
    { key: 'progreso/pizarras/excluded.json', type: 'json', value: { cooperationWeekNumber: 2, assets: { image: 'cooperation-asset:hidden' } } },
    { key: 'scope/board-assets/chosen', type: 'blob', blob: { hash: 'chosen' } },
    { key: 'scope/board-assets/hidden', type: 'blob', blob: { hash: 'hidden' } },
    { key: 'progreso/pizarras/legacy.json', type: 'json', value: { content: { shapes: [{ pdfReference: { materialId: 1 } }] } } },
  ].map(r => [r.key, r]))
  const { allowed, weeks, materialIds } = await selectionResources(resources, [2])
  assert.deepEqual(weeks, [1,2,3])
  for (const key of ['teoria/math/one.pdf', 'teoria/math/shared.pdf', 'teoria/math/new.pdf', 'progreso/pizarras/selected.json', 'progreso/pizarras/legacy.json', 'scope/board-assets/chosen']) assert.ok(allowed.has(key), key)
  for (const key of ['teoria/math/two.pdf', 'teoria/math/orphan.pdf', 'sintesis/images/excluded.png', 'progreso/pizarras/excluded.json', 'scope/board-assets/hidden', 'manifests/materials/math/week-2.json']) assert.equal(allowed.has(key), false, key)
  assert.deepEqual([...materialIds], ['1','3','4'])
  assert.deepEqual(projectSelectionTags({ tags: [{id:'a'}, {id:'b'}], assignments: { 1: ['a'], 2: ['b'] }, regions: { '1:p1': [], '2:p2': [] } }, materialIds), { tags: [{id:'a'}], assignments: { 1: ['a'] }, regions: { '1:p1': [] } })
})

test('legacy empty boards recover their week from their Estudio ID and pinned board assets follow selected weeks', async () => {
  const boardKey = (scope: number | string) => `progreso/pizarras/study-${createHash('sha256').update(JSON.stringify(['math', 'theory', scope])).digest('hex')}.json`
  const resources = Object.fromEntries([
    { key: 'sphere.json', type: 'json', value: { subjectId: 'math' } },
    { key: 'manifests/materials/math/week-1.json', type: 'json', value: { materials: [] } },
    { key: boardKey(2), type: 'json', value: { content: { strokes: [] } } },
    { key: boardKey('pinned'), type: 'json', value: { assets: { image: 'cooperation-asset:pinned' } } },
    { key: 'scope/board-assets/pinned', type: 'blob', blob: { hash: 'pinned' } },
  ].map(resource => [resource.key, resource]))
  const selected = await selectionResources(resources, [2])
  assert.deepEqual(selected.weeks, [1,2])
  assert.ok(selected.allowed.has(boardKey('pinned')))
  assert.ok(selected.allowed.has('scope/board-assets/pinned'))
  assert.equal(selected.allowed.has(boardKey(2)), false)
  const empty = await selectionResources(resources, [1,2])
  assert.equal(empty.allowed.has('scope/board-assets/pinned'), false)
})
