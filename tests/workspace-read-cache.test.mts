import assert from "node:assert/strict"
import test from "node:test"
import { WorkspaceReadCache } from "../lib/workspace-read-cache.ts"

test("coalesces pending reads and isolates mutable view snapshots", async () => {
  const cache = new WorkspaceReadCache(), root = {}
  let calls = 0
  const load = async () => { calls++; return [{ name: "original" }] }
  const [first, second] = await Promise.all([cache.read(root, "week", load), cache.read(root, "week", load)])
  first[0].name = "changed"
  assert.equal(second[0].name, "original")
  assert.equal((await cache.read(root, "week", load))[0].name, "original")
  assert.equal(calls, 1)
})

test("writes and folder changes discard old views, including pending reads", async () => {
  const cache = new WorkspaceReadCache(), root = {}
  let finish!: (value: string) => void
  const pending = cache.read(root, "week", () => new Promise<string>(resolve => { finish = resolve }))
  await Promise.resolve()
  cache.clear()
  assert.equal(await cache.read(root, "week", async () => "new"), "new")
  finish("old")
  assert.equal(await pending, "old")
  assert.equal(await cache.read(root, "week", async () => "unexpected"), "new")
  assert.equal(await cache.read({}, "week", async () => "other folder"), "other folder")
})

test("retries failed reads and expires settled views", async () => {
  const cache = new WorkspaceReadCache(0), root = {}
  await assert.rejects(cache.read(root, "week", async () => { throw new Error("permission") }), /permission/)
  assert.equal(await cache.read(root, "week", async () => "recovered"), "recovered")
  assert.equal(await cache.read(root, "week", async () => "external edit"), "external edit")
})

test("evicts old views when navigating many weeks", async () => {
  const cache = new WorkspaceReadCache(30_000, 2), root = {}
  for (const key of ["a", "b", "c"]) await cache.read(root, key, async () => key)
  assert.equal(await cache.read(root, "a", async () => "reloaded"), "reloaded")
})
