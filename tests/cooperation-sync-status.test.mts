import assert from 'node:assert/strict'
import test from 'node:test'
import { cooperationResourceBytes, cooperationSyncLabel } from '../lib/cooperation-sync-status.ts'

test('sync indicator stays hidden pending confirmation and shows unknown only offline or on failure', () => {
  const mirror = { binding: { id: 'shared', subjectId: 'prog3' } }
  const confirmed = new Set(['shared'])
  assert.equal(cooperationSyncLabel('prog3', [mirror], confirmed, true), '100%')
  assert.equal(cooperationSyncLabel('prog3', [mirror], confirmed, false), '???')
  assert.equal(cooperationSyncLabel('prog3', [mirror], new Set(), true), null)
  assert.equal(cooperationSyncLabel('other', [mirror], confirmed, true), null)
  assert.equal(cooperationSyncLabel('prog3', [{ ...mirror, error: 'failed' }], confirmed, true), '???')
  assert.equal(cooperationSyncLabel('prog3', [{ ...mirror, outbox: {} }], confirmed, true), null)
  assert.equal(cooperationSyncLabel('prog3', [{ ...mirror, transfer: { completed: 3, total: 4 } }], confirmed, true), '75%')
  assert.equal(cooperationSyncLabel('prog3', [{ ...mirror, transfer: { completed: 4, total: 4 }, outbox: {} }], confirmed, true), '99%')
})

test('sync details count UTF-8 metadata and file bytes while excluding deleted and unselected resources', () => {
  const resources = { pdf: { blob: { size: 2_500_000 } }, note: { value: 'ñ' }, deleted: { deleted: true, blob: { size: 9_000_000 } }, excluded: { blob: { size: 7_000_000 } } }
  assert.equal(cooperationResourceBytes(resources, new Set(['pdf', 'note', 'deleted'])), 2_500_004)
  assert.equal(cooperationResourceBytes({}), 0)
})
