import assert from 'node:assert/strict'
import test from 'node:test'
import { catalog, initial, insert, rotateLeft, inspect, steps } from '../lib/treap-demo/model.mjs'
import { layoutTrees } from '../lib/treap-demo/layout.mjs'
import { createTreeModel } from '../lib/treap-demo/operations.mjs'
import { compileSequence } from '../lib/treap-demo/sequence.mjs'
import example from '../lib/treap-demo/example.json' with { type: 'json' }
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('exporter rejects an invalid sequence without overwriting an existing HTML', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'treap-sequence-'))
  try {
    const input = join(directory, 'input.json'), output = join(directory, 'output.html')
    const invalid = structuredClone(example)
    invalid.steps[4].operation = { type: 'check' }
    await writeFile(input, JSON.stringify(invalid))
    await writeFile(output, 'existing HTML')
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/build-treap-demo.mjs', input, output]), /Paso 5/)
    assert.equal(await readFile(output, 'utf8'), 'existing HTML')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('declarative sequence computes independent snapshots and checks its result', () => {
  const before = structuredClone(example), lesson = compileSequence(example)
  assert.equal(lesson.steps.length, 6)
  assert.equal(lesson.steps[3].danger, true)
  assert.equal(lesson.steps[5].success, true)
  assert.deepEqual(lesson.steps[4].tree.children['30'], ['20', null])
  lesson.steps[4].tree.children['30'][0] = null
  assert.deepEqual(lesson.steps[5].tree.children['30'], ['20', null])
  assert.deepEqual(example, before)
})

test('declarative input rejects unknown operations, extra fields, bad focus and false success', () => {
  for (const modify of [
    lesson => { lesson.steps[0].operation = { type: 'execute', code: 'alert(1)' } },
    lesson => { lesson.steps[0].operation.code = 'alert(1)' },
    lesson => { lesson.steps[0].focus = ['missing'] },
    lesson => { lesson.steps[3].operation = { type: 'rotateRight', pivot: '30' } },
    lesson => { lesson.steps[4].operation = { type: 'check' } },
    lesson => { lesson.version = 2 },
    lesson => { lesson.steps = [] },
    lesson => { lesson.steps[5].success = true },
  ]) {
    const input = structuredClone(example); modify(input)
    assert.throws(() => compileSequence(input))
  }
})

test('right rotation is available through the declarative interface', () => {
  const lesson = compileSequence({
    version: 1, catalog: [{ id: 'a', key: 2, priority: 1 }, { id: 'b', key: 1, priority: 2 }],
    initial: { root: 'a', children: { a: ['b', null], b: [null, null] } },
    steps: [
      { title: 'Rotar', text: 'b sube', badge: 'Derecha', operation: { type: 'rotateRight', pivot: 'a' } },
      { title: 'Verificar', text: 'Correcto', badge: 'Correcto', operation: { type: 'check' } },
    ],
  })
  assert.equal(lesson.steps[0].tree.root, 'b')
  assert.equal(lesson.steps[1].success, true)
})

test('independent catalogs support empty insertion, negative/decimal keys and equal priorities', () => {
  const nodes = [{ id: 'root', key: -2.5, priority: 7 }, { id: 'smaller', key: -1000, priority: 7 }, { id: 'larger', key: 99999, priority: 8 }]
  const model = createTreeModel(nodes)
  nodes[0].key = 500 // The model owns a copy of the catalog.
  let tree = { root: null, children: {} }
  for (const id of ['root', 'smaller', 'larger']) tree = model.insert(tree, id)
  assert.deepEqual(model.inspect(tree), { order: [-1000, -2.5, 99999], violations: [['root', 'larger']] })
  const rotated = model.rotateLeft(tree, 'root')
  assert.equal(rotated.root, 'larger')
  assert.deepEqual(model.inspect(rotated).violations, [])
  assert.deepEqual(model.rotateRight(rotated, 'larger'), tree)
  assert.deepEqual(model.inspect({ root: null, children: {} }), { order: [], violations: [] })
})

test('both rotations transfer inner subtrees and preserve every generated BST', () => {
  // Fixed insertion order covers both directions, root and non-root pivots.
  const keys = [8, 4, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15]
  const model = createTreeModel(keys.map(key => ({ id: `key-${key}`, key, priority: 100 - key })))
  let tree = { root: null, children: {} }
  keys.forEach(key => { tree = model.insert(tree, `key-${key}`) })
  const snapshot = structuredClone(tree)
  for (const [id, [left, right]] of Object.entries(tree.children)) {
    if (right) {
      const rotated = model.rotateLeft(tree, id)
      assert.deepEqual(model.inspect(rotated).order, [...keys].sort((a, b) => a - b))
      assert.deepEqual(model.rotateRight(rotated, right), tree)
    }
    if (left) {
      const rotated = model.rotateRight(tree, id)
      assert.deepEqual(model.inspect(rotated).order, [...keys].sort((a, b) => a - b))
      assert.deepEqual(model.rotateLeft(rotated, left), tree)
    }
  }
  assert.deepEqual(tree, snapshot)
})

test('bad catalogs, malformed trees and impossible operations fail without changing input', () => {
  for (const catalog of [
    [{ id: 'a', key: NaN, priority: 1 }], [{ id: 'a', key: 1, priority: Infinity }],
    [{ id: '__proto__', key: 1, priority: 1 }],
    [{ id: 'a', key: 1, priority: 1 }, { id: 'a', key: 2, priority: 2 }],
    [{ id: 'a', key: 1, priority: 1 }, { id: 'b', key: 1, priority: 2 }],
    Array.from({ length: 65 }, (_, i) => ({ id: `n${i}`, key: i, priority: i })),
  ]) assert.throws(() => createTreeModel(catalog))
  const model = createTreeModel([{ id: 'a', key: 1, priority: 1 }, { id: 'b', key: 2, priority: 2 }])
  const good = { root: 'a', children: { a: [null, null] } }, snapshot = structuredClone(good)
  assert.throws(() => model.insert(good, 'a'))
  assert.throws(() => model.insert(good, 'unknown'))
  assert.throws(() => model.rotateRight(good, 'a'))
  assert.throws(() => model.rotateLeft(good, 'unknown'))
  assert.deepEqual(good, snapshot)
  for (const tree of [
    { root: 'a', children: { a: ['b', null], b: [null, null] } }, // Wrong side.
    { root: 'a', children: { a: [null, 'missing'] } },
    { root: 'a', children: { a: [null, 'a'] } },
    { root: 'a', children: { a: [null, null], b: [null, null] } },
    { root: null, children: { a: [null, null] } },
    { root: 'a', children: { a: [null] } },
  ]) {
    assert.throws(() => model.inspect(tree))
    assert.throws(() => model.insert(tree, 'b'))
    assert.throws(() => model.rotateLeft(tree, 'a'))
  }
})

test('layout supports arbitrary identifiers, single children, empty trees and a shared canvas', () => {
  const tree = { root: 'parent', children: { parent: ['negative-key', 'huge-key'], 'negative-key': [null, 'decimal-key'], 'decimal-key': [null, null], 'huge-key': [null, null] } }
  const snapshot = structuredClone(tree)
  const layout = layoutTrees([tree, { root: null, children: {} }])
  const p = layout.positions[0]
  assert.ok(p.get('negative-key').x < p.get('decimal-key').x)
  assert.ok(p.get('decimal-key').x < p.get('parent').x)
  assert.ok(p.get('parent').x < p.get('huge-key').x)
  assert.equal(layout.positions[1].size, 0)
  assert.deepEqual(tree, snapshot)
})

test('wide and deep trees expand the canvas without capsule collisions or clipping', () => {
  const children = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`n${i}`, [null, i < 23 ? `n${i + 1}` : null]]))
  const layout = layoutTrees([{ root: 'n0', children }, steps[0].tree])
  assert.ok(layout.width > 840 && layout.height > 500)
  for (const positions of layout.positions) {
    const nodes = [...positions.values()]
    for (const p of nodes) {
      assert.ok(p.x - 56 >= 0 && p.x + 56 <= layout.width)
      assert.ok(p.y - 31 >= 0 && p.y + 31 <= layout.height)
    }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      assert.ok(Math.abs(nodes[i].x - nodes[j].x) >= 112 || Math.abs(nodes[i].y - nodes[j].y) >= 62)
    }
  }
})

test('layout rejects cycles, missing references, shared children and disconnected nodes', () => {
  for (const tree of [
    { root: 'a', children: { a: ['a', null] } },
    { root: 'a', children: { a: [null, 'missing'] } },
    { root: 'a', children: { a: ['b', 'b'], b: [null, null] } },
    { root: 'a', children: { a: [null, null], b: [null, null] } },
    { root: 'a', children: { a: [null] } },
  ]) assert.throws(() => layoutTrees([tree]))
})

test('insertion and rotation preserve BST and repair exactly the priority conflict', () => {
  const original = structuredClone(initial)
  const inserted = insert(initial, '30')
  assert.deepEqual(initial, original)
  assert.deepEqual(inserted.children['20'], ['10', '30'])
  assert.deepEqual(inspect(inserted), { order: [10, 20, 30, 40, 60], violations: [['20', '30']] })
  const rotated = rotateLeft(inserted, '20')
  assert.deepEqual(rotated.children['40'], ['30', '60'])
  assert.deepEqual(rotated.children['30'], ['20', null])
  assert.deepEqual(rotated.children['20'], ['10', null])
  assert.deepEqual(inspect(rotated), { order: [10, 20, 30, 40, 60], violations: [] })
  assert.deepEqual(inserted.children['20'], ['10', '30'])
  assert.equal(steps.length, 6)
  steps.forEach((step, index) => assert.equal(inspect(step.tree).violations.length, index === 3 ? 1 : 0))
})

test('left rotation transfers the inner subtree and can replace the root', () => {
  const tree = { root: '20', children: { '20': ['10', '40'], '10': [null, null], '40': ['30', '60'], '30': [null, null], '60': [null, null] } }
  const rotated = rotateLeft(tree, '20')
  assert.equal(rotated.root, '40')
  assert.deepEqual(rotated.children['20'], ['10', '30'])
  assert.deepEqual(inspect(rotated).order, [10, 20, 30, 40, 60])
  assert.throws(() => rotateLeft(initial, '10'))
})
