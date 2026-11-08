import { resolveGraphPresentation } from './pdf-explanation-graphs.ts'
import { GRAPH_RUNTIME, GRAPH_STYLES } from './pdf-explanation-graphs-runtime.ts'
import { GRAPH_MATH_STYLES } from './pdf-explanation-math-styles.ts'
import { graphMathHtml } from './pdf-explanation-math.ts'
import type { ExplanationPreferences } from './pdf-explanation-preferences.ts'

const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")

export function graphPresentationHtml(input: unknown, preferences: ExplanationPreferences = {}): string {
  const data = resolveGraphPresentation(input)
  const formulas: Record<string, string> = Object.create(null)
  const collect = (value: unknown) => {
    if (typeof value === 'string') { const html = graphMathHtml(value); if (html) formulas[value] = html }
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(data)
  const mathCss = Object.keys(formulas).length ? GRAPH_MATH_STYLES : ''
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Verlo · mapa</title><style>${mathCss}\n${GRAPH_STYLES}</style></head><body><main><header><h1 id="title"></h1><span id="counter" role="status" aria-live="polite"></span></header><section id="step-intro" aria-live="polite"><h2 id="step-title"></h2><p id="step-objective"></p></section><section id="stage" tabindex="0" aria-label="Escenario gráfico; desplazá para explorar"><svg id="scene" viewBox="0 0 1000 560" role="img" aria-label="Grafo de la explicación"><g id="edges"></g><g id="nodes"></g></svg></section><section id="notes" aria-label="Comentarios del paso"></section><nav aria-label="Pasos"><button id="prev">Anterior</button><div id="dots" role="group" aria-label="Elegir paso"></div><div class="controls"><button id="replay">Repetir</button><button id="next">Siguiente</button></div></nav></main><script id="graph-data" type="application/json">${scriptJson(data)}</script><script id="graph-options" type="application/json">${scriptJson(preferences)}</script><script id="graph-math" type="application/json">${scriptJson(formulas)}</script><script>${GRAPH_RUNTIME}</script></body></html>`
}
