import assert from 'node:assert/strict'
import test from 'node:test'
import { cooperationDeletionName, hasMeaningfulCooperationRecovery } from '../lib/cooperation-review.ts'
import { mergeCooperation } from '../lib/cooperation-model.ts'

test('pending deletion names identify old records using their saved content', () => {
  assert.equal(cooperationDeletionName({ label: 'Elemento', key: 'manifest.json', value: { file_name: 'Práctica 3.pdf' } }), 'Práctica 3.pdf')
  assert.equal(cooperationDeletionName({ label: 'Elemento', key: 'manifest.json', value: { text_content: 'Resumen de listas' } }), 'Resumen de listas')
  assert.equal(cooperationDeletionName({ label: 'Elemento', key: 'teoria/Prog3/Parcial.pdf', value: { file: 'teoria/Prog3/Parcial.pdf' } }), 'Parcial.pdf')
  assert.equal(cooperationDeletionName({ label: 'Elemento', key: 'manifests/entries/Prog3/week-4.json' }), 'Contenido de semana 4')
})

test('first concurrent additions combine without recovered versions and real conflicts remain visible', () => {
  const conflicts: any[] = []
  const merged = mergeCooperation(undefined, [{ id: 1, file_name: 'Uno.pdf' }], [{ id: 2, file_name: 'Dos.pdf' }], conflicts) as any[]
  assert.equal(merged.length, 2); assert.deepEqual(conflicts, [])
  assert.equal(hasMeaningfulCooperationRecovery({ conflicts: [{ path: ['materials'], local: [{ id: 1, file_name: 'Uno.pdf' }], remote: [{ id: 2, file_name: 'Dos.pdf' }] }] }), false)
  assert.equal(hasMeaningfulCooperationRecovery({ conflicts: [{ path: ['createdAt'], local: 'one', remote: 'two' }] }), false)
  assert.equal(hasMeaningfulCooperationRecovery({ conflicts: [{ path: ['name'], local: 'Nombre A', remote: 'Nombre B' }] }), true)
  assert.equal(hasMeaningfulCooperationRecovery({ key: 'teoria/Prog3/Uno.pdf', blob: { hash: 'a'.repeat(64) } }), true)
})

test('locally generated fixed containers retain the original identity when PDFs or custom containers are added', () => {
  const base = [{ id: 10, kind: 'theory', name: 'Teoría' }, { id: 20, kind: 'practice', name: 'Práctica' }]
  const local = [{ id: 1010, kind: 'theory', name: 'Teoría' }, { id: 2020, kind: 'practice', name: 'Práctica' }, { id: 30, kind: 'custom', name: 'Resúmenes' }]
  const remote = [...base, { id: 40, kind: 'custom', name: 'Parciales' }]
  const conflicts: any[] = []
  const merged = mergeCooperation(base, local, remote, conflicts) as any[]
  assert.deepEqual(new Set(merged.map(row => row.id)), new Set([10,20,30,40]))
  assert.deepEqual(conflicts, [])
  const initial = mergeCooperation(undefined, local, remote, conflicts) as any[]
  assert.equal(initial.filter(row => row.kind === 'theory').length, 1)
  assert.equal(initial.find(row => row.kind === 'theory').id, 10)
  assert.deepEqual(conflicts, [])
})
