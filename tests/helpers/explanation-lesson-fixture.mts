import type { StructuredLesson, LessonDiagram } from "../../lib/pdf-explanation-structured.ts"

export const avlDiagram: LessonDiagram = {
  type: "diagram", id: "avl", kind: "tree", root: "D",
  nodes: ["D", "A", "B", "C", "E"].map(id => ({ id, label: id })),
  edges: [
    { id: "da", from: "D", to: "A", side: "left", label: "" },
    { id: "de", from: "D", to: "E", side: "right", label: "" },
    { id: "ab", from: "A", to: "B", side: "left", label: "" },
    { id: "ac", from: "A", to: "C", side: "right", label: "" },
  ], highlights: ["D", "A", "da"],
}
export const structuredFixture: StructuredLesson = {
  version: 2, title: "Del apunte al ejemplo", warnings: ["Las letras son etiquetas del apunte; no valores numéricos."],
  steps: [
    { id: "initial", title: "Balanceo del ABB", change: "Identificamos la raíz D y su hijo izquierdo A.", blocks: [
      { type: "text", text: "B y C son subárboles de A; E permanece conectado a D." }, avlDiagram,
    ] },
    { id: "right", title: "Rotación derecha", change: "A sube; D pasa a su derecha y C cambia de padre.", blocks: [
      { type: "rotation", diagramId: "avl", pivot: "D", direction: "right", highlights: ["A", "D", "ac"] },
    ] },
    { id: "left", title: "Rotación izquierda", change: "La operación inversa recupera la estructura inicial.", blocks: [
      { type: "rotation", diagramId: "avl", pivot: "A", direction: "left", highlights: ["D"] },
    ] },
    { id: "graph", title: "Un grafo dirigido", change: "Un grafo puede contener ciclos.", blocks: [
      { type: "diagram", id: "graph", kind: "graph", root: null,
        nodes: [{ id: "one", label: "Entrada" }, { id: "two", label: "Proceso" }],
        edges: [{ id: "go", from: "one", to: "two", side: "none", label: "avanza" }, { id: "back", from: "two", to: "one", side: "none", label: "repite" }], highlights: ["go"] },
    ] },
    { id: "sql", title: "Tabla SQL y fórmula", change: "SELECT nombre FROM alumnos WHERE nota >= 6", blocks: [
      { type: "table", caption: "Alumnos", columns: ["nombre", "nota"], rows: [["Ana", "8"], ["Luis", "4"]], highlights: [{ row: 0, column: 1 }] },
      { type: "formula", latex: "h \\in O(\\log n)" },
    ] },
  ],
}
