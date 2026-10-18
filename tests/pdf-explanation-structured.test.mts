import assert from "node:assert/strict"
import test from "node:test"
import { avlDiagram, structuredFixture } from "./helpers/explanation-lesson-fixture.mts"
import { resolveStructuredLesson, rotateLessonTree, treeInorder, validateDiagram } from "../lib/pdf-explanation-structured.ts"
import { structuredLessonHtml } from "../lib/server/pdf-explanation-renderer.ts"

test("AVL right and left rotations preserve identities, inorder and transferred subtree", () => {
  const right = rotateLessonTree(avlDiagram, "D", "right")
  assert.equal(right.root, "A")
  assert.equal(right.edges.find(edge => edge.id === "ac")?.from, "D")
  assert.deepEqual(treeInorder(right), ["B", "A", "C", "D", "E"])
  assert.deepEqual(rotateLessonTree(right, "A", "left"), avlDiagram)
  assert.equal(avlDiagram.root, "D", "rotation must not mutate its input")
  const resolved = resolveStructuredLesson(structuredFixture)
  assert.equal(resolved.steps[1].blocks[0].type, "diagram")
  assert.equal(resolved.steps[1].blocks[0].type === "diagram" && resolved.steps[1].blocks[0].root, "A")
})

test("rotations work below the root and reject missing children or graph operations", () => {
  const nested = structuredClone(avlDiagram)
  nested.nodes.push({ id: "F", label: "F" })
  nested.edges.push({ id: "ef", from: "E", to: "F", side: "right", label: "" })
  const rotated = rotateLessonTree(nested, "E", "left")
  assert.equal(rotated.root, "D")
  assert.equal(rotated.edges.find(edge => edge.id === "de")?.to, "F")
  assert.deepEqual(treeInorder(rotated), treeInorder(nested))
  assert.throws(() => rotateLessonTree(avlDiagram, "B", "left"), /falta/)
  assert.throws(() => rotateLessonTree({ ...avlDiagram, kind: "graph", root: null, edges: [], highlights: [] }, "B", "left"), /árbol/)
})

test("rejects missing nodes, duplicate slots, multiple parents, cycles and disconnected nodes", () => {
  for (const mutate of [
    (d: typeof avlDiagram) => { d.edges[0].to = "missing" },
    (d: typeof avlDiagram) => { d.edges[1].side = "left" },
    (d: typeof avlDiagram) => { d.edges[1].to = "A" },
    (d: typeof avlDiagram) => { d.root = "missing" },
    (d: typeof avlDiagram) => { d.nodes.push({ id: "F", label: "F" }) },
    (d: typeof avlDiagram) => { d.edges.push({ id: "cycle", from: "B", to: "D", side: "left", label: "" }) },
    (d: typeof avlDiagram) => { d.nodes.push(d.nodes[0]) },
    (d: typeof avlDiagram) => { d.highlights.push("missing") },
  ]) {
    const diagram = structuredClone(avlDiagram); mutate(diagram)
    assert.throws(() => validateDiagram(diagram))
  }
})

test("validates tables, cross-step references and stable diagram labels", () => {
  const lesson = structuredClone(structuredFixture)
  lesson.steps.reverse()
  assert.throws(() => resolveStructuredLesson(lesson), /inexistente/)
  const tableLesson = structuredClone(structuredFixture)
  const table = tableLesson.steps[4].blocks[0]
  if (table.type !== "table") throw new Error("fixture")
  table.rows[0].pop()
  assert.throws(() => resolveStructuredLesson(tableLesson), /columnas/)
  table.rows[0].push("8"); table.highlights[0].row = 50
  assert.throws(() => resolveStructuredLesson(tableLesson), /rango/)
  const changed = structuredClone(structuredFixture)
  const diagram = structuredClone(avlDiagram); diagram.nodes[0].label = "changed"
  changed.steps[1].blocks = [diagram]
  assert.throws(() => resolveStructuredLesson(changed), /etiqueta/)
  assert.throws(() => resolveStructuredLesson({ ...structuredFixture, script: "alert(1)" }))
})

test("compiles safe offline HTML with versioned JSON and embedded KaTeX fonts", () => {
  const html = structuredLessonHtml(structuredFixture)
  assert.ok(html.includes('id="verlo-lesson"'))
  assert.ok(html.includes('"version":2'))
  assert.ok(html.includes("data:font/woff2;base64,"))
  assert.ok(!html.includes("url(fonts/"))
  const injection = structuredClone(structuredFixture)
  injection.title = '</script><script>window.injected=true</script>'
  assert.ok(!structuredLessonHtml(injection).includes('<script>window.injected=true</script>'))
  injection.steps[4].blocks = [{ type: "formula", latex: "\\invalidCommand{" }]
  assert.throws(() => structuredLessonHtml(injection), /Fórmula inválida/)
})
