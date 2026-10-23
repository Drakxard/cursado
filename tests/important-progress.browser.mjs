import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import { readFile, mkdir } from "node:fs/promises"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"

async function importantUiBundle() {
  return build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { StudyImportantTasks } from "./components/study-important-tasks";
      const files = new Map(JSON.parse(sessionStorage.getItem("important-files") || "[]"));
      if (!files.has("importantes.json") && window.seedTasks) files.set("importantes.json", JSON.stringify({ version: 1, tasks: window.seedTasks }));
      const directory = {
        async getDirectoryHandle() { return directory },
        async getFileHandle(name, options) {
          if (!files.has(name) && !options?.create) throw new DOMException("Missing", "NotFoundError");
          return { async getFile() { return new File([files.get(name)], name) },
            async createWritable() { let text; return { async write(value) { text = value }, async close() { files.set(name, text); window.saved = text; sessionStorage.setItem("important-files", JSON.stringify([...files])) } } } };
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
}

test("Important UI saves tasks and deletes topics only after a hold, without link prompts", async t => {
  const result = await importantUiBundle()
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
  assert.equal(await page.getByPlaceholder("Agregar tema...").count(), 0)
  await page.getByRole("button", { name: "Agregar tema", exact: true }).click()
  await page.getByPlaceholder("Agregar tema...").fill("Unidad 1")
  await page.keyboard.press("Enter")
  assert.equal(await page.getByRole("dialog", { name: "Agregar link" }).count(), 0)
  await page.getByRole("button", { name: "Agregar tema", exact: true }).click()
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
  const chip = page.getByRole("button", { name: "Tema Unidad 1. Abrir pizarra. Mantener presionado para borrar", exact: true, includeHidden: true })
  await chip.click()
  await page.getByRole("dialog", { name: "Pizarra de Parcial · Unidad 1" }).waitFor()
  await page.getByRole("button", { name: "Volver a Temas", exact: true }).click()
  assert.equal(await chip.count(), 1)
  await page.waitForFunction(() => JSON.parse(window.saved || '{}').tasks?.[0]?.topics?.length === 1)
  assert.equal(await page.getByText("Plus +", {exact:true}).count(), 0)
  const saved = await page.evaluate(() => JSON.parse(window.saved).tasks[0])
  assert.equal(saved.text, "Parcial")
  assert.deepEqual(saved.topics, ["Unidad 1"])
  await page.clock.install()
  const bounds = await chip.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.clock.runFor(700)
  await page.mouse.up()
  await page.getByRole("alertdialog", { name: "¿Borrar este tema?" }).waitFor()
  assert.equal(await chip.count(), 1)
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  assert.equal(await chip.count(), 1)
  await chip.hover()
  await page.mouse.down()
  await page.clock.runFor(700)
  await page.mouse.up()
  await page.getByRole("alertdialog", { name: "¿Borrar este tema?" }).waitFor()
  await page.getByRole("button", { name: "Confirmar", exact: true }).click()
  assert.equal(await chip.count(), 0)
  assert.equal(await page.getByRole("dialog").count(), 0)
  await page.waitForFunction(() => JSON.parse(window.saved).tasks[0].topics.length === 0)
  const row = page.getByRole("group", { name: "Fila Parcial", exact: true })
  const holdRow = async () => {
    const bounds = await row.boundingBox()
    await page.mouse.move(bounds.x + bounds.width - 3, bounds.y + bounds.height - 3)
    await page.mouse.down()
    await page.clock.runFor(700)
    await page.mouse.up()
  }
  await row.dispatchEvent("click")
  assert.equal(await page.getByRole("alertdialog").count(), 0)
  await page.getByRole("button", { name: "Parcial", exact: true }).focus()
  await holdRow()
  await page.getByRole("alertdialog", { name: "¿Borrar esta fila?" }).waitFor()
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  assert.equal(await row.count(), 1)
  await holdRow()
  await page.getByRole("alertdialog", { name: "¿Borrar esta fila?" }).waitFor()
  await page.getByRole("button", { name: "Confirmar", exact: true }).click()
  assert.equal(await row.count(), 0)
  await page.waitForFunction(() => JSON.parse(window.saved).tasks.length === 0)
  await page.keyboard.press("ArrowLeft")
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  assert.deepEqual(errors, [])
})

test("Important rows stay in place until leaving and reentering, including after date edits", async t => {
  const bundle = await importantUiBundle()
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route("https://study.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.goto("https://study.test/")
  await page.evaluate(() => {
    const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    window.seedTasks = [["P3", 23], ["EO", 21], ["BD", 19], ["Igual", 21]].map(([text, days]) => {
      const today = new Date()
      const due = new Date(today)
      due.setDate(due.getDate() + days)
      return { id: text, text, startDate: key(today), dueDate: key(due), url: "", topics: ["Tema"] }
    })
  })
  const enter = async () => {
    await page.keyboard.press("ArrowRight")
    await page.getByRole("heading", { name: "Importantes", exact: true }).waitFor()
    await page.getByRole("button", { name: "BD", exact: true }).waitFor()
  }
  const rows = page.locator(".relative.overflow-hidden.bg-card.border.rounded-lg")
  const order = () => rows.evaluateAll(elements => elements.map(element => element.querySelector("button:not([aria-label])")?.textContent))
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  await enter()
  assert.deepEqual(await order(), ["BD", "EO", "Igual", "P3"])
  await page.getByRole("button", { name: "Agregar", exact: true }).click()
  assert.equal(await rows.last().getByText("7d", { exact: true }).count(), 1)
  await rows.last().getByRole("button", { name: "Haz clic para escribir...", exact: true }).click()
  await page.getByPlaceholder("Escribe tu tarea...").fill("Nueva")
  await page.keyboard.press("Enter")
  assert.deepEqual(await order(), ["BD", "EO", "Igual", "P3", "Nueva"])
  // Change the new task to a short deadline without moving its row.
  await rows.last().getByText("7d", { exact: true }).click()
  const calendar = page.locator("[data-calendar-gestures]")
  await calendar.locator("button.border.h-24").filter({ hasText: /^1$/ }).click()
  assert.deepEqual(await order(), ["BD", "EO", "Igual", "P3", "Nueva"])
  // A board overlay is still part of this visit to Important tasks.
  await rows.first().getByRole("button", { name: /Tema Tema\. Abrir pizarra/ }).click()
  await page.getByRole("dialog").waitFor()
  await page.getByRole("button", { name: "Volver a Temas", exact: true }).click()
  assert.deepEqual(await order(), ["BD", "EO", "Igual", "P3", "Nueva"])
  await page.locator("h1").filter({ hasText: "Importantes" }).click()
  await page.keyboard.press("ArrowLeft")
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  await enter()
  assert.deepEqual(await order(), ["Nueva", "BD", "EO", "Igual", "P3"])
  await page.waitForFunction(() => JSON.parse(window.saved || '{}').tasks?.[0]?.text === "Nueva")
  await page.reload()
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  await enter()
  assert.deepEqual(await order(), ["Nueva", "BD", "EO", "Igual", "P3"])
  // A later date stays in place until reentry through touch gestures as well.
  await rows.first().getByText(/\d+d/, { exact: true }).click()
  await page.getByRole("button", { name: "Mes siguiente", exact: true }).click()
  await calendar.locator("button.border.h-24").filter({ hasText: /^28$/ }).click()
  assert.deepEqual(await order(), ["Nueva", "BD", "EO", "Igual", "P3"])
  const swipe = async (from, to) => {
    await page.locator("h1").filter({ hasText: "Importantes" }).dispatchEvent("touchstart", { touches: [{ clientX: from, clientY: 100, identifier: 1 }] })
    await page.locator("h1").filter({ hasText: "Importantes" }).dispatchEvent("touchend", { changedTouches: [{ clientX: to, clientY: 100, identifier: 1 }], touches: [] })
  }
  await swipe(200, 50)
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  await page.getByRole("heading", { name: "Estudio", exact: true }).dispatchEvent("touchstart", { touches: [{ clientX: 50, clientY: 100, identifier: 1 }] })
  await page.getByRole("heading", { name: "Estudio", exact: true }).dispatchEvent("touchend", { changedTouches: [{ clientX: 200, clientY: 100, identifier: 1 }], touches: [] })
  await page.getByRole("heading", { name: "Importantes", exact: true }).waitFor()
  assert.deepEqual(await order(), ["BD", "EO", "Igual", "P3", "Nueva"])
})

test("Important topic buttons match the wide layout and wrap without overflow on touch screens", async t => {
  const bundle = await importantUiBundle()
  const stylesheet = await postcss([tailwindcss()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })
  const theme = await readFile("components/progress-original/theme.css", "utf8")
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.route("https://study.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.goto("https://study.test/")
  await page.evaluate(() => {
    window.seedTasks = [{ id: "bd", text: "Base de Datos", startDate: "2026-10-17", dueDate: "2026-11-05", url: "", topics: ["u4", "u5", "u6"] }]
  })
  await page.addStyleTag({ content: stylesheet.css + theme })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole("heading", { name: "Estudio", exact: true }).waitFor()
  await page.keyboard.press("ArrowRight")
  const row = page.getByRole("group", { name: "Fila Base de Datos", exact: true })
  await row.waitFor()
  const topics = row.getByRole("button", { name: /^Tema / })
  const boxes = await topics.evaluateAll(elements => elements.map(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height } }))
  assert.equal(boxes.length, 3)
  assert.ok(boxes.every(box => box.height >= 72 && box.width > 100))
  assert.ok(boxes.every(box => Math.abs(box.y - boxes[0].y) < 1))
  const name = await row.getByRole("button", { name: "Base de Datos", exact: true }).boundingBox()
  assert.ok(boxes[0].x > name.x + name.width)
  assert.equal(await row.getByText("0%", { exact: true }).count(), 0)
  await mkdir("test-results", { recursive: true })
  await page.screenshot({ path: "test-results/important-topics-wide.png" })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const mobile = await topics.evaluateAll(elements => elements.map(element => { const { y, height } = element.getBoundingClientRect(); return { y, height } }))
  assert.ok(mobile[2].y > mobile[0].y)
  assert.ok(mobile.every(box => box.height >= 72))
  await page.screenshot({ path: "test-results/important-topics-mobile.png" })
})
