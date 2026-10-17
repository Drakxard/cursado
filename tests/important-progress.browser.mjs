import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("original Important UI edits tasks, topics, dates and links with local persistence", async t => {
  const result = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { StudyImportantTasks } from "./components/study-important-tasks";
      const files = new Map();
      const directory = {
        async getDirectoryHandle() { return directory },
        async getFileHandle(name, options) {
          if (!files.has(name) && !options?.create) throw new DOMException("Missing", "NotFoundError");
          return { async getFile() { return new File([files.get(name)], name) },
            async createWritable() { let text; return { async write(value) { text = value }, async close() { files.set(name, text); window.saved = text } } } };
        }
      };
      window.workspace = { rootHandle: directory, isReady: true };
      createRoot(document.getElementById("root")).render(<StudyImportantTasks><h1>Estudio</h1></StudyImportantTasks>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" },
    plugins: [{ name: "workspace-fixture", setup(build) {
      build.onResolve({ filter: /^@\/components\/local-workspace-provider$/ }, () => ({ path: "workspace", namespace: "fixture" }))
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useLocalWorkspace = () => window.workspace", loader: "js" }))
    } }],
  })
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("https://study.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.goto("https://study.test/")
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  await page.keyboard.press("ArrowRight")
  await page.getByRole("heading", { name: "Importantes", exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "IMP", exact: true }).count(), 0)
  assert.equal(await page.getByRole("button", { name: /Plus \+.*0%/ }).count(), 1)
  await page.getByRole("button", { name: "Agregar", exact: true }).click()
  await page.getByRole("button", { name: "Haz clic para escribir...", exact: true }).click()
  await page.getByPlaceholder("Escribe tu tarea...").fill("Parcial")
  await page.keyboard.press("Enter")
  await page.getByPlaceholder("Agregar tema...").fill("Unidad 1")
  await page.keyboard.press("Enter")
  await page.locator("h1").filter({ hasText: "Importantes" }).click()
  await page.getByText("7d", { exact: true }).click()
  await page.getByRole("button", { name: "Mes siguiente", exact: true }).waitFor()
  await page.getByRole("button", { name: "Cerrar calendario", exact: true }).click()
  await page.locator('[role="button"]').filter({ hasText: "Parcial" }).first().dispatchEvent("click")
  await page.getByRole("dialog", { name: "Agregar link" }).waitFor()
  await page.getByPlaceholder("https://...").fill("https://example.com")
  await page.getByRole("button", { name: "Guardar", exact: true }).click()
  await page.waitForFunction(() => JSON.parse(window.saved || '{}').tasks?.[0]?.url === "https://example.com")
  const saved = await page.evaluate(() => JSON.parse(window.saved).tasks[0])
  assert.equal(saved.text, "Parcial")
  assert.deepEqual(saved.topics, ["Unidad 1"])
  await page.keyboard.press("ArrowLeft")
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
