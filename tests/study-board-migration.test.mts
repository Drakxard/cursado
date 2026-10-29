import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'
import { writeWorkspaceJson, readWorkspaceJson } from '../lib/workspace-json.ts'
import { convertStudyBoard, migrationNeedsReview, acceptMigrationTypes, STUDY_CONVERTER_VERSION, type LegacyStudyBoard } from '../lib/study-board-migration.ts'
import { openStudyBoard, saveStudyBoard, confirmStudyMigration } from '../lib/study-board-workspace.ts'

const snapshot = (boardId = 'example'): LegacyStudyBoard => ({ version: 1, boardId, name: 'Example', assets: {}, content: { strokes: [{ points: [{ x: 12, y: 20 }, { x: 40, y: 80 }], color: '#ff0000', width: 3 }], texts: [{ id: 'a', text: 'Trabajado', x: 30, y: 40, fontSize: 24, color: '#000000' }], media: [], shapes: [], camera: { x: 3, y: 7, zoom: 2 } } })
const upload = async () => 'images/example.png'

test('conversion preserves geometry, originals and stable identifiers without mutating the source', async () => {
  const source = snapshot(); source.content.strokes[0].groupId = 'group'
  const original = structuredClone(source)
  const first = await convertStudyBoard(source, upload), second = await convertStudyBoard(source, upload)
  assert.deepEqual(first, second); assert.deepEqual(source, original)
  assert.deepEqual(first.objects[0].points, [12, 20, 40, 80])
  assert.equal(first.objects[0].groupId, 'legacy:example:group')
  assert.equal(first.objects[1].runs[0].text, 'Trabajado')
  assert.equal(first.objects[1].legacyOriginal, source.content.texts[0])
})

test('acceptance accumulates by type, but images, partial conversions and a new converter need review', async () => {
  const { report } = await convertStudyBoard(snapshot(), upload)
  assert.equal(migrationNeedsReview(report, {}), true)
  const approved = acceptMigrationTypes({}, report)
  assert.equal(migrationNeedsReview(report, approved), false)
  const source = snapshot('other'); source.content.media.push({ id: 'image', kind: 'image', assetId: 'asset', width: 100, height: 80 })
  source.assets.asset = 'data:image/png;base64,AA=='
  const images = await convertStudyBoard(source, upload)
  assert.equal(migrationNeedsReview(images.report, approved), true)
  const all = acceptMigrationTypes(approved, images.report)
  assert.equal(migrationNeedsReview(images.report, all), false)
  assert.equal(migrationNeedsReview({ ...report, version: STUDY_CONVERTER_VERSION + 1 }, all), true)
  const partial = { ...report, partial: ['texts'] }
  assert.equal(migrationNeedsReview(partial, all), true)
  assert.equal(acceptMigrationTypes({}, partial).texts, undefined)
})

test('empty boards skip the question; failed assets cannot be accepted', async () => {
  const source = snapshot(); source.content.strokes = []; source.content.texts = []
  const empty = await convertStudyBoard(source, upload)
  assert.equal(migrationNeedsReview(empty.report, {}), false)
  source.content.media.push({ id: 'image', kind: 'image' })
  const failed = await convertStudyBoard(source, async () => { throw new Error('Archivo ausente') })
  assert.equal(migrationNeedsReview(failed.report, {}), true)
  assert.throws(() => acceptMigrationTypes({}, failed.report), /errores pendientes/)
})

test('one room per board across parallel opens, original intact, drafts survive cancellation and confirmation', async () => {
  const { root } = memoryWorkspace(), source = snapshot()
  await writeWorkspaceJson(root, 'progreso/pizarras/example.json', source)
  const [a, b] = await Promise.all([openStudyBoard(root, 'example'), openStudyBoard(root, 'example')])
  assert.equal(a.record.roomId, b.record.roomId)
  const other = await openStudyBoard(root, 'other'); assert.notEqual(other.record.roomId, a.record.roomId)
  await saveStudyBoard(root, 'example', { draft: 'checkpoint', status: 'cancelled' })
  const reopened = await openStudyBoard(root, 'example')
  assert.equal(reopened.record.draft, 'checkpoint'); assert.equal(reopened.record.status, 'cancelled'); assert.deepEqual(reopened.approved, {})
  const { report } = await convertStudyBoard(source, upload)
  await confirmStudyMigration(root, 'example', report)
  await saveStudyBoard(root, 'example', { status: 'pending', draft: 'new-checkpoint' })
  const confirmed = await openStudyBoard(root, 'example')
  assert.equal(confirmed.record.status, 'accepted'); assert.equal(confirmed.record.draft, 'new-checkpoint')
  assert.equal(migrationNeedsReview(report, confirmed.approved), false)
  assert.deepEqual(await readWorkspaceJson(root, 'progreso/pizarras/example.json', null), source)
})

test('parallel migration uses an immutable source; completed boards do not reload original assets', async () => {
  const { root } = memoryWorkspace(), source = snapshot()
  await writeWorkspaceJson(root, 'progreso/pizarras/example.json', source)
  await openStudyBoard(root, 'example')
  const changed = structuredClone(source); changed.content.texts[0].text = 'Cambio posterior'
  await writeWorkspaceJson(root, 'progreso/pizarras/example.json', changed)
  assert.deepEqual((await openStudyBoard(root, 'example')).snapshot, source)
  await saveStudyBoard(root, 'example', { imported: true, draft: 'checkpoint' })
  assert.equal((await openStudyBoard(root, 'example')).snapshot, null)
})
