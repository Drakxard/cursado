import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'
import { writeWorkspaceJson, readWorkspaceJson } from '../lib/workspace-json.ts'
import { convertStudyBoard, repairStudyReviewMarker, migrationNeedsReview, acceptMigrationTypes, STUDY_CONVERTER_VERSION, type LegacyStudyBoard } from '../lib/study-board-migration.ts'
import { openStudyBoard, saveStudyBoard, confirmStudyMigration } from '../lib/study-board-workspace.ts'

const snapshot = (boardId = 'example'): LegacyStudyBoard => ({ version: 1, boardId, name: 'Example', assets: {}, content: { strokes: [{ points: [{ x: 12, y: 20 }, { x: 40, y: 80 }], color: '#ff0000', width: 3 }], texts: [{ id: 'a', text: 'Trabajado', x: 30, y: 40, fontSize: 24, color: '#000000' }], media: [], shapes: [], camera: { x: 3, y: 7, zoom: 2 } } })
const upload = async () => 'images/example.png'

test('review markers keep their circle, geometry and saved camera without partial migration', async () => {
  const source = snapshot()
  const marker = { id:'review',kind:'circle',visualType:'review-marker',x:1135.370460069432,y:145.8020705296085,width:56,height:56,color:'#202020',strokeWidth:3.5,reviewView:{center:{x:693.2792668363143,y:437.52452590707617},zoom:1},labelFontSize:16 }
  source.content.shapes=[marker]
  const result=await convertStudyBoard(source,upload)
  const migrated=result.objects.find(object=>object.study?.kind==='review')!
  assert.equal(migrated.width,56); assert.equal(migrated.height,56)
  assert.equal(migrated.x,marker.x); assert.equal(migrated.shape,'ellipse')
  assert.deepEqual(migrated.study.view,marker.reviewView)
  assert.deepEqual(result.report.partial,[])
  assert.equal(migrated.legacyOriginal,marker)
})

test('repair old marker placeholders in place without resetting moved/resized objects or other cards', () => {
  const original={id:'review',kind:'circle',visualType:'review-marker',x:100,y:200,width:56,height:56,reviewView:{center:{x:500,y:600},zoom:2}}
  const placeholder={id:'stable-id',type:'text',x:300,y:400,width:320,height:62,rotation:12,study:{kind:'legacy',original},legacyOriginal:original}
  const repaired=repairStudyReviewMarker(placeholder)!
  assert.equal(repaired.id,'stable-id'); assert.equal(repaired.x,300); assert.equal(repaired.y,400)
  assert.equal(repaired.width,56); assert.equal(repaired.height,56); assert.equal(repaired.rotation,12)
  assert.deepEqual(repaired.study.view,original.reviewView)
  assert.equal(repairStudyReviewMarker({...placeholder,width:90,height:110})!.width,90)
  assert.equal(repairStudyReviewMarker({...placeholder,study:{kind:'pdf'}}),null)
  assert.equal(repairStudyReviewMarker({...placeholder,...repaired}),null)
  assert.equal(placeholder.width,320)
})

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
