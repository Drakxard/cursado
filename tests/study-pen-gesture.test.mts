import assert from 'node:assert/strict'
import test from 'node:test'
import { PenGesture } from '../pizarra-sync/packages/client-web/src/pen-gesture.ts'

test('Shift projects both directions and fixes the straight segment on release', () => {
  for (const [dx, dy, expected] of [
    [100, 20, [10, 30, 110, 30]], [-100, 20, [10, 30, -90, 30]],
    [20, 100, [10, 30, 10, 130]], [20, -100, [10, 30, 10, -70]],
  ] as const) {
    const gesture = new PenGesture(10, 30)
    gesture.move(15, 45); gesture.move(10 + dx, 30 + dy)
    assert.deepEqual(gesture.points(true), expected)
    assert.deepEqual(gesture.points(false), expected)
    assert.deepEqual(gesture.points(false), expected)
  }
})

test('Shift changes axis live, keeps the previous axis on ties, and never mutates a preview', () => {
  const gesture = new PenGesture(0, 0)
  assert.deepEqual(gesture.points(true), [0, 0])
  gesture.move(10, 10)
  const first = gesture.points(true)
  assert.deepEqual(first, [0, 0, 10, 0])
  gesture.move(10, 40)
  assert.deepEqual(gesture.points(true), [0, 0, 0, 40])
  gesture.move(-50, -50)
  assert.deepEqual(gesture.points(true), [0, 0, 0, -50])
  assert.deepEqual(first, [0, 0, 10, 0])
  assert.deepEqual(gesture.points(false), [0, 0, 0, -50])
  assert.deepEqual(gesture.points(true), [0, 0, 0, -50])
})

test('Freehand continues from the fixed tip and later Shift segments preserve earlier lines', () => {
  const gesture = new PenGesture(10, 20)
  gesture.move(110, 40)
  const straight = gesture.points(true)
  assert.deepEqual(straight, [10, 20, 110, 20])
  assert.deepEqual(gesture.points(false), straight)
  gesture.move(120, 45)
  assert.deepEqual(gesture.points(false), [10, 20, 110, 20, 120, 25])
  gesture.move(125, 90)
  assert.deepEqual(gesture.points(true), [10, 20, 110, 20, 110, 70])
  assert.deepEqual(gesture.points(false), [10, 20, 110, 20, 110, 70])
  gesture.move(130, 100)
  assert.deepEqual(gesture.points(false), [10, 20, 110, 20, 110, 70, 115, 80])
})
