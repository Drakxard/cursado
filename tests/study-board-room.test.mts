import assert from 'node:assert/strict'
import test from 'node:test'
import { cooperativeStudyRoomId } from '../lib/study-board-room.ts'
import type { SphereBinding } from '../lib/client/cooperation-files.ts'
import { openStudyBoard, saveStudyBoard } from '../lib/study-board-workspace.ts'
import { memoryWorkspace } from './helpers/cooperation-filesystem.mjs'

const owner: SphereBinding = { id: 'sphere-shared', groupId: 'group', subjectId: 'algebra', storageKey: 'Algebra', sourceId: 'algebra', sourceKey: 'Algebra', name: 'Álgebra', color: '#123456', owner: true }
const receiver: SphereBinding = { ...owner, subjectId: 'coop-sphere', storageKey: 'Cooperativo', owner: false }

test('cooperative participants join one room from local aliases even when opening before the owner', async () => {
  const receiverId = 'study-container-sphere-s'
  const b = memoryWorkspace(), a = memoryWorkspace()
  const roomB = await cooperativeStudyRoomId(receiver, receiverId)
  const first = await openStudyBoard(b.root, receiverId, undefined, roomB)
  const roomA = await cooperativeStudyRoomId(owner, 'study-container')
  const second = await openStudyBoard(a.root, 'study-container', undefined, roomA)
  assert.equal(first.record.roomId, second.record.roomId)
  assert.match(roomA, /^study-[a-f0-9-]{36}$/)
  assert.equal((await openStudyBoard(b.root, receiverId, undefined, roomB)).record.roomId, roomA)
  assert.equal(await cooperativeStudyRoomId({ ...receiver, pathAliases: { 'study-container': receiverId } }, receiverId), roomA)
  assert.notEqual(await cooperativeStudyRoomId(owner, 'study-other'), roomA)
  assert.notEqual(await cooperativeStudyRoomId({ ...owner, id: 'other-sphere' }, 'study-container'), roomA)
})

test('existing personal rooms converge without losing drafts, imports or recovery records', async () => {
  const a = memoryWorkspace(), b = memoryWorkspace()
  const aId = 'study-container', bId = 'study-container-sphere-s'
  const oldA = await openStudyBoard(a.root, aId), oldB = await openStudyBoard(b.root, bId)
  assert.notEqual(oldA.record.roomId, oldB.record.roomId)
  await saveStudyBoard(a.root, aId, { draft: 'trazos de A', imported: true, status: 'accepted' })
  await saveStudyBoard(b.root, bId, { draft: 'trazos de B', imported: true, status: 'accepted' })
  const room = await cooperativeStudyRoomId(owner, aId)
  const newA = await openStudyBoard(a.root, aId, undefined, room)
  const newB = await openStudyBoard(b.root, bId, undefined, await cooperativeStudyRoomId(receiver, bId))
  assert.equal(newA.record.roomId, newB.record.roomId)
  assert.equal(newA.record.draft, 'trazos de A'); assert.equal(newB.record.draft, 'trazos de B')
  assert.equal(newA.record.imported, true); assert.equal(newB.record.status, 'accepted')
  assert.equal((await a.json(`progreso/pizarra-sync/${aId}.recovery-${oldA.record.roomId}.json`)).draft, 'trazos de A')
  assert.equal((await b.json(`progreso/pizarra-sync/${bId}.recovery-${oldB.record.roomId}.json`)).draft, 'trazos de B')
  assert.equal((await openStudyBoard(a.root, aId, undefined, room)).record.roomId, room)
})
