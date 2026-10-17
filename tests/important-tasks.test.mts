import assert from "node:assert/strict"
import test from "node:test"
import { importantTaskProgress, readImportantTasks, writeImportantTasks, type ImportantTask } from "../lib/important-tasks.ts"
import { folderFixture } from "./helpers/synthesis-folder-fixture.mts"

const task: ImportantTask = { id: "one", text: "Parcial", startDate: "2026-10-10", dueDate: "2026-10-20", url: "https://example.com", topics: ["Unidad 1"] }

test("important tasks persist all fields in the authorized workspace folder", async () => {
  const { root, files } = folderFixture()
  assert.deepEqual(await readImportantTasks(root), [])
  await writeImportantTasks(root, [task])
  assert.ok(files.has("progreso/importantes.json"))
  assert.deepEqual(await readImportantTasks(root), [task])
  await writeImportantTasks(root, [])
  assert.deepEqual(await readImportantTasks(root), [])
})

test("corrupt important task files surface an error instead of becoming an empty list", async () => {
  const { root, files } = folderFixture()
  await writeImportantTasks(root, [task])
  files.set("progreso/importantes.json", new Blob(['{"version":1,"tasks":[{}]}']))
  await assert.rejects(readImportantTasks(root), /formato válido/)
})

test("deadline progress uses calendar days and caps elapsed progress", () => {
  assert.deepEqual(importantTaskProgress(task, new Date(2026, 9, 17, 23)), { total: 10, remaining: 3, elapsed: 7, percentage: 70 })
  assert.equal(importantTaskProgress(task, new Date(2026, 9, 22)).percentage, 100)
  assert.equal(importantTaskProgress(task, new Date(2026, 9, 9)).percentage, 0)
})
