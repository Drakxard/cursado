import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

test("PDF viewer saves the encrypted Datalab configuration as JSON and verifies it", async () => {
  const source = await readFile(new URL("../public/pdfjs/web/viewer-explanations.js", import.meta.url), "utf8")
  const writeBody = source.match(/  async function write\(root, path, text\) \{([\s\S]*?)\n  \}/)[1]
  const saveBody = source.match(/          await write\(state.root, "User.Datalab",[^\n]+\n[\s\S]*?(?=          dialog.querySelector\("input"\).value)/)[0]
  let contents = "previous"
  let closed = false
  const fileHandle = async (_root, path) => {
    assert.equal(path, "User.Datalab")
    return { createWritable: async () => ({
      write: async value => {
        assert.equal(typeof value, "string", "FileSystemWritableFileStream requires serialized JSON")
        contents = value
      },
      close: async () => { closed = true },
      abort: async () => {},
    }) }
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const write = new AsyncFunction("fileHandle", "BroadcastChannel", "root", "path", "text", writeBody)
  const read = async () => JSON.parse(contents)
  const save = new AsyncFunction("write", "read", "state", "result", saveBody)
  await save((...args) => write(fileHandle, class { postMessage() {} close() {} }, ...args), read, { root: {} }, { token: "encrypted-token" })
  assert.equal(closed, true)
  assert.deepEqual(JSON.parse(contents), { version: 1, token: "encrypted-token" })
  await assert.rejects(save(async () => {}, async () => ({ token: "other" }), { root: {} }, { token: "encrypted-token" }), /verificar/)
})
