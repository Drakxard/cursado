import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import katex from "katex"
import { resolveStructuredLesson, StructuredLessonError } from "../pdf-explanation-structured.ts"
import { STRUCTURED_LESSON_RUNTIME, STRUCTURED_LESSON_STYLES } from "../pdf-explanation-runtime.ts"
import { graphPresentationHtml } from "../pdf-explanation-graph-html.ts"

let mathStyles: string | undefined
function offlineMathStyles() {
  if (mathStyles) return mathStyles
  const require = createRequire(import.meta.url)
  const directory = dirname(require.resolve("katex/dist/katex.min.css"))
  // Only WOFF2 is needed in supported browsers. Embed every referenced font so
  // exported HTML can run inside an opaque-origin sandbox with no network.
  mathStyles = readFileSync(join(directory, "katex.min.css"), "utf8").replace(/src:[^;}]+/g, declaration => {
    const font = declaration.match(/url\(([^)]+\.woff2)\)/)?.[1]
    if (!font) return declaration
    return `src:url(data:font/woff2;base64,${readFileSync(join(directory, font)).toString("base64")}) format('woff2')`
  })
  return mathStyles
}

const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")

export function structuredLessonHtml(input: unknown): string {
  if (input && typeof input === "object" && "plantilla" in input) {
    return graphPresentationHtml(input)
  }
  const lesson = resolveStructuredLesson(input)
  const formulas: Record<string, string> = {}
  lesson.steps.forEach((step, stepIndex) => step.blocks.forEach((block, blockIndex) => {
    if (block.type !== "formula") return
    try {
      formulas[`${stepIndex}:${blockIndex}`] = katex.renderToString(block.latex, {
        displayMode: true, throwOnError: true, trust: false, strict: "error", maxExpand: 200, maxSize: 20,
      })
    } catch { throw new StructuredLessonError(`Fórmula inválida en el paso ${stepIndex + 1}: revisá su sintaxis LaTeX.`) }
  }))
  const css = Object.keys(formulas).length ? offlineMathStyles() : ""
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Verlo</title><style>${css}\n${STRUCTURED_LESSON_STYLES}</style></head><body><main><header><p class="eyebrow">EXPLICACIÓN PASO A PASO</p><h1 id="title"></h1><div id="warnings"></div></header><p id="counter" aria-live="polite"></p><progress id="progress" aria-label="Progreso de la explicación"></progress><section id="screen" aria-label="Paso actual"></section><nav aria-label="Pasos"><button id="prev">Anterior</button><button id="replay">Repetir</button><button id="next">Siguiente</button></nav></main><script id="verlo-lesson" type="application/json">${scriptJson(lesson)}</script><script id="verlo-formulas" type="application/json">${scriptJson(formulas)}</script><script>${STRUCTURED_LESSON_RUNTIME}</script></body></html>`
}
