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

test("PDF viewer recovers truncated Datalab credentials and OCR cache without overwriting files", async () => {
  const source = await readFile(new URL("../public/pdfjs/web/viewer-explanations.js", import.meta.url), "utf8")
  const body = source.match(/  async function read\(root, path\) \{([\s\S]*?)\n  \}/)[1]
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const read = new AsyncFunction("fileHandle", "root", "path", body)
  for (const text of ["", '{"token":', "null", '{"token":"encrypted"}']) {
    const fileHandle = async () => ({ getFile: async () => ({ text: async () => text }) })
    for (const path of ["User.Datalab", "manifests/subject-voice/pdf/hash/extraction.json"]) {
      assert.deepEqual(await read(fileHandle, {}, path), text.includes('"encrypted"') ? { token: "encrypted" } : null)
    }
    if (!text || text.endsWith(":")) await assert.rejects(read(fileHandle, {}, "explanations.json"), /explanations.json/)
  }
})

test("PDF transcription reports empty or invalid server responses with their HTTP status", async () => {
  const source = await readFile(new URL("../public/pdfjs/web/viewer-explanations.js", import.meta.url), "utf8")
  const body = source.match(/      const responseText = await response.text\(\);([\s\S]*?)(?=      if \(!response.ok)/)[0]
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const parse = new AsyncFunction("response", `let payload;\n${body}\nreturn payload;`)
  for (const text of ["", "<html>Unavailable</html>", "null"]) {
    await assert.rejects(parse(new Response(text, { status: 502 })), /HTTP 502/)
  }
  assert.deepEqual(await parse(Response.json({ markdown: "Page" })), { markdown: "Page" })
})
