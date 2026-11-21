import assert from 'node:assert/strict'
import test from 'node:test'
import { PenGesture } from '../pizarra-sync/packages/client-web/src/pen-gesture.ts'

test('Shift projects both directions onto the dominant axis and preserves freehand points', () => {
  for (const [dx, dy, expected] of [
    [100, 20, [10, 30, 110, 30]], [-100, 20, [10, 30, -90, 30]],
    [20, 100, [10, 30, 10, 130]], [20, -100, [10, 30, 10, -70]],
  ] as const) {
    const gesture = new PenGesture(10, 30)
    gesture.move(15, 45); gesture.move(10 + dx, 30 + dy)
    assert.deepEqual(gesture.points(true), expected)
    assert.deepEqual(gesture.points(false), [10, 30, 15, 45, 10 + dx, 30 + dy])
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
  assert.equal(gesture.points(false).length, 8)
  assert.deepEqual(gesture.points(true), [0, 0, 0, -50])
})
