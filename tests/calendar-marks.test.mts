import assert from 'node:assert/strict'
import test from 'node:test'
import { readCalendarMarks, writeCalendarMark } from '../lib/calendar-marks.ts'
import { folderFixture } from './helpers/synthesis-folder-fixture.mts'

test('calendar marks persist separately from tasks and preserve other dates across saves', async () => {
  const { root, files } = folderFixture()
  assert.deepEqual(await readCalendarMarks(root), {})
  await writeCalendarMark(root, '2026-11-04', '  Parcial  ')
  await Promise.all([writeCalendarMark(root, '2026-11-17', 'Entrega'), writeCalendarMark(root, '2026-12-04', 'Consulta')])
  assert.deepEqual(await readCalendarMarks(root), { '2026-11-04': 'Parcial', '2026-11-17': 'Entrega', '2026-12-04': 'Consulta' })
  await writeCalendarMark(root, '2026-11-04', 'Repaso')
  assert.equal((await readCalendarMarks(root))['2026-11-04'], 'Repaso')
  assert.equal(files.has('progreso/importantes.json'), false)
  await assert.rejects(writeCalendarMark(root, '2026-02-30', 'Inválida'))
  await assert.rejects(writeCalendarMark(root, '2026-11-04', '   '))
  files.set('progreso/calendario-marcas.json', new Blob(['{"version":1,"marks":[]}']))
  await assert.rejects(readCalendarMarks(root), /formato válido/)
})
