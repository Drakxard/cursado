import { structuredFixture } from "../tests/helpers/explanation-lesson-fixture.mts"
import { structuredLessonHtml } from "../lib/server/pdf-explanation-renderer.ts"
import type { StructuredLesson } from "../lib/pdf-explanation-structured.ts"

// Controlled comparison of the payload needed to produce the SAME presentation.
// This is not a model benchmark: token use and inference latency require live
// provider usage, which is captured by explanationStream's diagnostic events.
const cases: Record<string, StructuredLesson> = {
  AVL: { ...structuredFixture, steps: structuredFixture.steps.slice(0, 3) },
  graph: { ...structuredFixture, steps: [structuredFixture.steps[3]] },
  SQL: { ...structuredFixture, steps: [{ ...structuredFixture.steps[4], blocks: structuredFixture.steps[4].blocks.filter(block => block.type === "table") }] },
  math: { ...structuredFixture, steps: [{ ...structuredFixture.steps[4], blocks: structuredFixture.steps[4].blocks.filter(block => block.type === "formula") }] },
}
const results = Object.entries(cases).map(([name, lesson]) => {
  const json = JSON.stringify(lesson)
  const started = performance.now()
  const html = structuredLessonHtml(JSON.parse(json))
  const validationAndCompilationMs = performance.now() - started
  const legacyStarted = performance.now()
  // The former path accepted a complete model-generated HTML document.
  const oldHtmlAccepted = /<html\b[\s\S]*?<\/html>/i.test(html)
  return {
    name, sameInput: true, expectedSteps: lesson.steps.length, oldHtmlAccepted,
    oldModelOutputBytes: Buffer.byteLength(html), newModelOutputBytes: Buffer.byteLength(json),
    oldLocalHtmlAcceptanceMs: performance.now() - legacyStarted,
    newLocalValidationAndCompilationMs: validationAndCompilationMs,
    totalInferenceLatencyMs: null, providerTokens: null,
  }
})
console.log(JSON.stringify({ mode: "controlled-offline", note: "Bytes are not tokens. Local timings exclude inference, OCR and network; no live provider was called. Semantic cases and controls are checked in the unit/browser tests.", results }, null, 2))
