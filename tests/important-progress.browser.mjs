import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("Important UI saves tasks and deletes topics only after a hold, without link prompts", async t => {
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
  assert.equal(await page.getByRole("dialog", { name: "Agregar link" }).count(), 0)
  await page.getByPlaceholder("Agregar tema...").fill("Unidad")
  await page.keyboard.press("Space")
  assert.equal(await page.getByPlaceholder("Agregar tema...").inputValue(), "Unidad ")
  await page.locator("h1").filter({ hasText: "Importantes" }).click()
  await page.getByText("7d", { exact: true }).click()
  await page.getByRole("button", { name: "Mes siguiente", exact: true }).waitFor()
  const calendar = page.locator("[data-calendar-gestures]")
  const monthBefore = await calendar.locator("h2").innerText()
  await calendar.dispatchEvent("wheel", { deltaY: 100 })
  assert.notEqual(await calendar.locator("h2").innerText(), monthBefore)
  // A burst of wheel events must not skip many months.
  const monthAfter = await calendar.locator("h2").innerText()
  await calendar.dispatchEvent("wheel", { deltaY: 100 })
  assert.equal(await calendar.locator("h2").innerText(), monthAfter)
  await calendar.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 100, clientY: 100 }] })
  await calendar.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 200, clientY: 100 }] })
  assert.equal(await calendar.locator("h2").innerText(), monthBefore)
  await page.getByRole("heading", { name: "Estudio", exact: true }).isHidden().then(value => assert.equal(value, true))
  // Touching again clears click suppression from the synthetic swipe.
  await calendar.dispatchEvent("touchstart", { touches: [{ identifier: 2, clientX: 100, clientY: 100 }] })
  await calendar.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 2, clientX: 100, clientY: 100 }] })
  await page.getByRole("button", { name: "Cerrar calendario", exact: true }).click()
  await page.locator(".relative.overflow-hidden.bg-card.border.rounded-lg").first().dispatchEvent("click")
  assert.equal(await page.getByRole("dialog", { name: "Agregar link" }).count(), 0)
  const chip = page.getByRole("button", { name: "Tema Unidad 1. Mantener presionado para borrar", exact: true })
  await chip.click()
  assert.equal(await chip.count(), 1)
  await page.waitForFunction(() => JSON.parse(window.saved || '{}').tasks?.[0]?.topics?.length === 1)
  const saved = await page.evaluate(() => JSON.parse(window.saved).tasks[0])
  assert.equal(saved.text, "Parcial")
  assert.deepEqual(saved.topics, ["Unidad 1"])
  await page.clock.install()
  const bounds = await chip.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.clock.runFor(700)
  await page.mouse.up()
  assert.equal(await chip.count(), 0)
  await page.waitForFunction(() => JSON.parse(window.saved).tasks[0].topics.length === 0)
  await page.keyboard.press("ArrowLeft")
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
