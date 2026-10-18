import assert from "node:assert/strict"
import test from "node:test"
import { zodSchema } from "ai"
import { resolveGraphPresentation, graphGenerationSchema } from "../lib/pdf-explanation-graphs.ts"
import { azureExplanationFormatSchema, decodeAzureExplanation } from "../lib/pdf-explanation-formats.ts"
import { structuredLessonHtml } from "../lib/server/pdf-explanation-renderer.ts"
import { graphFixture, gridGraphFixture } from "./helpers/explanation-graphs-fixture.mts"
import { generalGraphFixture } from './helpers/explanation-general-graphs-fixture.mts'

test('generic attributes, per-step data, directed relations and cycles round-trip for both transports', () => {
  for (const topic of ['process', 'network', 'dependencies'] as const) {
    const graph = generalGraphFixture(topic)
    const resolved = resolveGraphPresentation(graph)
    assert.deepEqual(resolved.elementos_iniciales[1].datos, graph.elementos_iniciales[1].datos)
    assert.equal(resolved.diapositivas[1].posiciones.B.datos![0].valor, 'completado')
    assert.equal(resolved.diapositivas[2].posiciones.A.datos, null)
    assert.deepEqual(resolved.diapositivas[2].posiciones.B.datos, [])
    const wire = { lesson: { ...graph, diapositivas: graph.diapositivas.map(s => ({ ...s, posiciones: Object.entries(s.posiciones).map(([id, p]) => ({ id, ...p })) })) } }
    assert.deepEqual(decodeAzureExplanation(wire), graph)
    assert.equal(resolved.diapositivas[0].aristas[2].desde, resolved.diapositivas[0].aristas[2].hacia)
    assert.equal(resolved.diapositivas[0].aristas[0].dirigida, true)
  }
})

test('graph metadata remains bounded data rather than executable markup', () => {
  const graph = generalGraphFixture()
  for (const mutate of [
    (d: any) => { d.elementos_iniciales[0].datos = Array(5).fill({ etiqueta: 'Dato', valor: '1' }) },
    (d: any) => { d.elementos_iniciales[0].datos[0].valor = 1 },
    (d: any) => { d.diapositivas[0].posiciones.A.datos = [{ etiqueta: 'Dato', valor: 'x'.repeat(121) }] },
    (d: any) => { d.diapositivas[0].aristas[0].dirigida = 'true' },
    (d: any) => { d.diapositivas[0].aristas[0].etiqueta = 'x'.repeat(81) },
  ]) { const bad = structuredClone(graph); mutate(bad); assert.throws(() => resolveGraphPresentation(bad)) }
})

test("grid maps all boundary cells inside the scene and rejects collisions including subtrees", () => {
  const resolved = resolveGraphPresentation(gridGraphFixture)
  assert.deepEqual(resolved.diapositivas[0].posiciones.D, { x: 450, y: 50, estado: "alerta" })
  for (const [fila, columna, x, y] of [[1,1,50,50],[6,10,950,440]]) {
    const single = { ...gridGraphFixture, elementos_iniciales: [{ id: "D", tipo: "subarbol", etiqueta: "D" }],
      diapositivas: [{ paso: 1, posiciones: { D: { fila, columna, estado: "normal" } }, aristas: [], comentarios: [] }] }
    assert.deepEqual(resolveGraphPresentation(single).diapositivas[0].posiciones.D, { x, y, estado: "normal" })
  }
  for (const mutation of [
    (d: any) => d.diapositivas[0].posiciones.A = d.diapositivas[0].posiciones.D,
    (d: any) => d.diapositivas[0].posiciones.A = { fila: 6, columna: 2, estado: "normal" },
    (d: any) => d.diapositivas[0].posiciones.D.fila = 0,
    (d: any) => d.diapositivas[0].posiciones.D.columna = 11,
    (d: any) => d.diapositivas[0].posiciones.D.fila = 1.5,
    (d: any) => d.diapositivas[0].comentarios[0].posicion = "cualquier-lugar",
  ]) { const d = structuredClone(gridGraphFixture); mutation(d); assert.throws(() => resolveGraphPresentation(d)) }
  assert.ok(graphGenerationSchema.safeParse(gridGraphFixture).success)
  assert.ok(!graphGenerationSchema.safeParse(graphFixture).success, "new generation requests grid data only")
})

test("topology strings normalize to edges and receive the same reference and duplicate validation", () => {
  const input = structuredClone(gridGraphFixture)
  input.diapositivas[0].aristas = ["D -> A", "D->E", "A -> B", "A->C"]
  assert.deepEqual(resolveGraphPresentation(input).diapositivas[0].aristas, graphFixture.diapositivas[0].aristas)
  input.diapositivas[0].aristas.push("D->A")
  assert.throws(() => resolveGraphPresentation(input), /duplicada/)
  input.diapositivas[0].aristas = ["D -> missing"]
  assert.throws(() => resolveGraphPresentation(input), /inexistente/)
  input.diapositivas[0].aristas = ["D => A"]
  assert.throws(() => resolveGraphPresentation(input))
})

test("graph presentation preserves the public position-map contract and compiles offline", () => {
  assert.deepEqual(resolveGraphPresentation(graphFixture), graphFixture)
  const html = structuredLessonHtml(graphFixture)
  assert.ok(html.includes('id="graph-data"'))
  assert.ok(html.includes("connect-src 'none'"))
  assert.ok(!html.includes('src="http'))
  const malicious = structuredClone(graphFixture)
  malicious.titulo = '</script><script>window.injected=true</script>'
  assert.ok(!structuredLessonHtml(malicious).includes('<script>window.injected=true'))
})

test("graph validation rejects invalid references, positions, styles, steps and duplicates", () => {
  const mutations: ((data: any) => void)[] = [
    d => d.elementos_iniciales.push(d.elementos_iniciales[0]),
    d => delete d.diapositivas[0].posiciones.A,
    d => d.diapositivas[0].posiciones.extra = d.diapositivas[0].posiciones.A,
    d => d.diapositivas[0].posiciones.A.x = 1001,
    d => d.diapositivas[0].posiciones.A.y = NaN,
    d => d.diapositivas[0].posiciones.A.estado = "bad",
    d => d.diapositivas[0].aristas[0].hacia = "missing",
    d => d.diapositivas[0].aristas.push(d.diapositivas[0].aristas[0]),
    d => d.diapositivas[0].aristas[0].estilo = "javascript",
    d => d.diapositivas[0].comentarios[0].anclado_a = "missing",
    d => d.diapositivas[0].comentarios[0].offset_x = Infinity,
    d => d.diapositivas[0].paso = 2,
    d => d.script = "alert(1)",
  ]
  for (const mutate of mutations) { const input = structuredClone(graphFixture); mutate(input); assert.throws(() => resolveGraphPresentation(input)) }
})

test("Azure wire has an object root and fixed properties, and decodes positions losslessly", async () => {
  const wire = { lesson: { ...gridGraphFixture, diapositivas: gridGraphFixture.diapositivas.map(s => ({ ...s,
    posiciones: Object.entries(s.posiciones).map(([id, position]) => ({ id, ...position })),
  })) } }
  assert.deepEqual(decodeAzureExplanation(wire), gridGraphFixture)
  const schema = await zodSchema(azureExplanationFormatSchema).jsonSchema
  assert.equal(schema.type, "object")
  function check(value: any) {
    if (!value || typeof value !== "object") return
    if (value.type === "object") assert.equal(value.additionalProperties, false)
    Object.values(value).forEach(check)
  }
  check(schema)
  wire.lesson.diapositivas[0].posiciones.push(wire.lesson.diapositivas[0].posiciones[0])
  assert.throws(() => decodeAzureExplanation(wire), /duplicados/)
})
