import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const source = readFileSync(new URL("../public/pdfjs/web/viewer-custom.js", import.meta.url), "utf8")
const functionSource = (name: string, next: string) => source.slice(source.indexOf(`  async function ${name}(`), source.indexOf(`  function ${next}(`, source.indexOf(`  async function ${name}(`)))
const check = functionSource("assertInscreenConfigurationAvailable", "workspaceIdToSegments")
const load = functionSource("loadInscreenState", "getInscreenAnnotationEntries")

test("PDF reading stays quiet without R2 and loads synchronization after configuration", async () => {
  let configured = false, reads = 0
  const toasts: unknown[] = []
  const context = {
    URLSearchParams, INSCREEN_CONFIGURATION_MESSAGE: "Configurar servicios",
    state: {inscreenLoaded:false,query:{materialId:1},app:{pdfDocument:{numPages:4},pdfViewer:{currentPageNumber:1}}},
    canUseInscreen: () => true, loadInscreenConfigToken: async () => "encrypted",
    isInscreenConfigurationUnavailable: (error: Error) => error.name === "InscreenConfigurationUnavailable",
    fetch: async () => Response.json({configured:true,services:{r2:configured}}),
    inscreenApiFetch: async () => { reads++; return Response.json({consumedAnnotationIds:[]}) },
    requireOkJson: async (response: Response) => response.json(),
    getInscreenMaterialContext: () => ({materialId:1,contentRevision:1}),
    window:{localStorage:{getItem:()=>null}},
    showToast: (...args: unknown[]) => toasts.push(args), console,
  }
  const run = runInNewContext(`${check}\n${load}\nloadInscreenState`, context)
  await run()
  assert.equal(reads,0)
  assert.equal(toasts.length,0)
  assert.equal(context.state.inscreenLoaded,false)
  configured = true
  await run()
  assert.equal(reads,1)
  assert.equal(toasts.length,0)
  assert.equal(context.state.inscreenLoaded,true)
})
