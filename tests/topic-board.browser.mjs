import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("each topic reopens its own real board and Escape saves to the workspace before returning", async t => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { StudyImportantTasks } from "./components/study-important-tasks";
      (async () => {
        const root = await navigator.storage.getDirectory();
        const progress = await root.getDirectoryHandle("progreso", { create: true });
        const file = await progress.getFileHandle("importantes.json", { create: true });
        if (!(await file.getFile()).size) {
          const writer = await file.createWritable();
          await writer.write(JSON.stringify({ version: 1, tasks: [{ id: "task", text: "BD", startDate: "2026-10-17", dueDate: "2026-10-24", url: "", topics: ["Unidad 1", "Unidad 2"] }] }));
          await writer.close();
        }
        window.workspace = { rootHandle: root, isReady: true };
        createRoot(document.getElementById("root")).render(<StudyImportantTasks><h1>Estudio</h1></StudyImportantTasks>);
      })();
    ` }, bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" },
    plugins: [{ name: "workspace", setup(build) {
      build.onResolve({ filter: /^@\/components\/local-workspace-provider$/ }, () => ({ path: "workspace", namespace: "fixture" }))
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useLocalWorkspace = () => window.workspace", loader: "js" }))
    } }],
  })
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ serviceWorkers: "block" })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("https://study.test/**", async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith("/pizarra/")) return route.fulfill({ contentType: "text/html", body: '<style>[role=dialog]{position:fixed;inset:0;display:flex;flex-direction:column;background:white;z-index:150}iframe{width:100%;flex:1;min-height:0}</style><div id="root"></div>' })
    const relative = url.pathname === "/pizarra/" ? "pizarra/index.html" : url.pathname.slice(1)
    const file = path.resolve("public", relative)
    const mime = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml" }[path.extname(file)] || "application/octet-stream"
    try { return route.fulfill({ contentType: mime, body: await readFile(file) }) }
    catch { return route.fulfill({ status: 404, body: "Missing" }) }
  })
  await page.goto("https://study.test/")
  const mount = async () => {
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
    await page.keyboard.press("ArrowRight")
    await page.getByRole("heading", { name: "Importantes", exact: true }).waitFor()
  }
  await mount()
  const open = async topic => {
    await page.getByRole("button", { name: `Tema ${topic}. Abrir pizarra. Mantener presionado para borrar`, exact: true }).click()
    const iframe = page.frameLocator(`iframe[title="Pizarra de BD · ${topic}"]`)
    await iframe.locator("canvas").first().waitFor()
    await page.getByRole("status").filter({ hasText: "Abriendo pizarra" }).waitFor({ state: "hidden" })
    return iframe
  }
  const readBoards = () => page.evaluate(async () => {
    const directory = await (await window.workspace.rootHandle.getDirectoryHandle("progreso")).getDirectoryHandle("pizarras")
    const boards = []
    for await (const handle of directory.values()) boards.push(JSON.parse(await (await handle.getFile()).text()))
    return boards
  })
  await page.evaluate(() => localStorage.setItem("pizarra_activa", "unrelated-board"))
  const first = await open("Unidad 1")
  const canvas = await first.locator("canvas").first().boundingBox()
  await page.mouse.move(canvas.x + 250, canvas.y + 200)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 370, canvas.y + 280, { steps: 8 })
  await page.mouse.up()
  // A workspace write failure must keep the board open so the user can retry.
  const firstFrame = page.frames().find(frame => new URL(frame.url()).pathname === "/pizarra/")
  await firstFrame.evaluate(() => {
    const create = FileSystemFileHandle.prototype.createWritable
    window.failTopicSave = true
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (window.failTopicSave && this.name.endsWith(".json")) throw new DOMException("Permission revoked", "NotAllowedError")
      return create.apply(this, args)
    }
  })
  // Escape immediately, before the normal autosave delay.
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").getByRole("alert").waitFor()
  assert.equal(await page.getByRole("dialog").count(), 1)
  await firstFrame.evaluate(() => { window.failTopicSave = false })
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const saved = await readBoards()
  assert.equal(saved.length, 1)
  assert.ok(saved[0].content.strokes.length > 0)
  assert.equal(await page.evaluate(() => localStorage.getItem("pizarra_activa")), "unrelated-board")
  await open("Unidad 2")
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const two = await readBoards()
  assert.equal(two.length, 2)
  assert.equal(two.find(board => board.name.endsWith("Unidad 2")).content.strokes.length, 0)
  // Reload the study UI and discard the board cache to prove restoration from the workspace file.
  await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open("pizarra-dispositivo", 1); request.onsuccess = () => resolve(request.result) })
    await new Promise(resolve => { const tx = database.transaction("boards", "readwrite"); tx.objectStore("boards").clear(); tx.oncomplete = resolve })
    database.close()
  })
  await page.reload()
  await mount()
  await open("Unidad 1")
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const restored = await readBoards()
  assert.ok(restored.find(board => board.boardId === saved[0].boardId).content.strokes.length > 0)
  assert.equal(await page.getByRole("heading", { name: "Importantes", exact: true }).isVisible(), true)
  assert.deepEqual(errors, [])
})
