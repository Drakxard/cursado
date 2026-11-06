import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import { memoryWorkspace } from "./helpers/cooperation-filesystem.mjs"

test("week navigation reuses local views without scanning other weeks and invalidates after writes", async () => {
  const bundle = await build({
    stdin: { contents: `export * as data from './lib/local-workspace-data'; export { setReadyWorkspaceHandle } from './lib/local-workspace-client';`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "localMaterials",
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: `window.memoryWorkspace = ${memoryWorkspace.toString()}` })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(async () => {
      const fs = memoryWorkspace(), reads = []
      for (let week = 1; week <= 12; week++) {
        await fs.put(`manifests/materials/algebra/week-${week}.json`, { version: 1, subjectId: "algebra", weekNumber: week, materials: [{
          id: week, subject_id: "algebra", week_number: week, session_date: "2026-03-02", material_type: "theory", order_index: 0,
          file_name: `week-${week}.pdf`, drive_file_id: `workspace://theory/algebra/week-${week}.pdf`, is_checkup_done: false,
        }] })
        await fs.put(`theory/algebra/week-${week}.pdf`, "%PDF-test")
      }
      // A missing PDF must not delay or prevent displaying its metadata.
      fs.files.delete("theory/algebra/week-1.pdf")
      function track(directory, prefix = "") {
        return {
          ...directory,
          async getDirectoryHandle(name, options) { return track(await directory.getDirectoryHandle(name, options), prefix + name + "/") },
          async getFileHandle(name, options) { reads.push(prefix + name); return directory.getFileHandle(name, options) },
        }
      }
      const root = track(fs.root)
      localMaterials.setReadyWorkspaceHandle(root)
      const { listLocalSubjectDayMaterials: list, listLocalPinnedSubjectMaterials: pinned, updateLocalMaterial } = localMaterials.data
      const [initial, fixed] = await Promise.all([list({ subjectId: "algebra", weekNumber: 1 }), pinned("algebra")])
      const coldReads = [...reads]
      initial[0].file_name = "view-only-change.pdf"
      reads.length = 0
      const cached = await list({ subjectId: "algebra", weekNumber: 1 })
      await pinned("algebra")
      const warmReads = reads.length
      let openingError
      try { await localMaterials.data.getWorkspaceFile(cached[0].drive_file_id) }
      catch (error) { openingError = error.name }
      await list({ subjectId: "algebra", weekNumber: 2 })
      reads.length = 0
      await list({ subjectId: "algebra", weekNumber: 1 })
      const returnReads = reads.length
      await updateLocalMaterial(1, { is_checkup_done: true })
      const updated = await list({ subjectId: "algebra", weekNumber: 1 })
      await fs.put("manifests/material-containers.json", { algebra: [{ id: 99, kind: "custom", isPinned: true, orderIndex: 2 }] })
      const last = await fs.json("manifests/materials/algebra/week-12.json")
      last.materials[0].container_id = 99
      await fs.put("manifests/materials/algebra/week-12.json", last)
      window.dispatchEvent(new Event("cursado-workspace-saved"))
      reads.length = 0
      const pinnedMaterials = await pinned("algebra")
      const pinnedFileChecks = reads.filter(path => path.startsWith("theory/"))
      const containers = await localMaterials.data.listLocalSubjectMaterialContainers("algebra")
      await fs.put("manifests/materials/algebra/week-1.json", { materials: [] })
      window.dispatchEvent(new Event("focus"))
      const afterFocus = await list({ subjectId: "algebra", weekNumber: 1 })
      const other = memoryWorkspace()
      localMaterials.setReadyWorkspaceHandle(other.root)
      const afterFolderChange = await list({ subjectId: "algebra", weekNumber: 1 })
      return { coldReads, warmReads, returnReads, openingError, fixed, cached, updated, pinnedMaterials, pinnedFileChecks, containers, afterFocus, afterFolderChange }
    })
    assert.equal(result.coldReads.length, 4, "the cold listing reads only catalog, week, containers and tags")
    assert.ok(result.coldReads.every(path => path.startsWith("manifests/")), "listing never opens PDFs or verifies recovery copies")
    assert.ok(result.coldReads.every(path => !/week-(?:[2-9]|1[0-2])\.json$/.test(path)), "opening one week must not read every other material manifest")
    assert.equal(result.warmReads, 0, "reopening the week and pinned list must perform no filesystem reads")
    assert.equal(result.returnReads, 0, "returning from another week reuses the snapshot")
    assert.deepEqual(result.fixed, [])
    assert.equal(result.cached[0].file_name, "week-1.pdf")
    assert.equal(result.openingError, "NotFoundError", "missing files are detected when opened")
    assert.equal(result.updated[0].is_checkup_done, true)
    assert.deepEqual(result.pinnedMaterials.map(material => material.id), [12])
    assert.deepEqual(result.pinnedFileChecks, [], "pinned listings also use metadata without opening any PDF")
    assert.equal(result.containers.reduce((sum, container) => sum + container.materialCount, 0), 12)
    assert.deepEqual(result.afterFocus, [])
    assert.deepEqual(result.afterFolderChange, [])
  } finally { await browser.close() }
})
