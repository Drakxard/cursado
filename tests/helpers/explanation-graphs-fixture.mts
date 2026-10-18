import type { GraphPresentation } from "../../lib/pdf-explanation-graphs.ts"

export const graphFixture = {
  plantilla: "pantilla1_grafos", titulo: "Rotación Simple a la Derecha (AVL)",
  elementos_iniciales: [
    { id: "D", tipo: "nodo", etiqueta: "D" }, { id: "A", tipo: "nodo", etiqueta: "A" },
    ...["B", "C", "E"].map(id => ({ id, tipo: "subarbol" as const, etiqueta: id })),
  ],
  diapositivas: [{
    paso: 1,
    posiciones: { D: { x: 500, y: 120, estado: "alerta" }, A: { x: 380, y: 220, estado: "normal" },
      E: { x: 620, y: 220, estado: "atenuado" }, B: { x: 300, y: 340, estado: "normal" }, C: { x: 460, y: 340, estado: "normal" } },
    aristas: [{ desde: "D", hacia: "A", estilo: "solido" }, { desde: "D", hacia: "E", estilo: "solido" },
      { desde: "A", hacia: "B", estilo: "solido" }, { desde: "A", hacia: "C", estilo: "solido" }],
    comentarios: [{ anclado_a: "D", offset_x: 80, offset_y: -20, color: "rojo", texto: "Analizamos el desbalanceo" }],
  }, {
    paso: 2,
    posiciones: { A: { x: 500, y: 120, estado: "exito" }, D: { x: 620, y: 220, estado: "normal" },
      B: { x: 380, y: 220, estado: "normal" }, C: { x: 540, y: 340, estado: "destacado" }, E: { x: 700, y: 340, estado: "normal" } },
    aristas: [{ desde: "A", hacia: "B", estilo: "solido" }, { desde: "A", hacia: "D", estilo: "animado_verde" },
      { desde: "D", hacia: "C", estilo: "animado_amarillo" }, { desde: "D", hacia: "E", estilo: "solido" }],
    comentarios: [{ anclado_a: "A", offset_x: -120, offset_y: -10, color: "verde", texto: "A sube como nueva raíz" },
      { anclado_a: "C", offset_x: 0, offset_y: 60, color: "amarillo", texto: "C pasa a ser hijo izquierdo de D" }],
  }],
} satisfies GraphPresentation

export const gridGraphFixture: GraphPresentation = {
  ...graphFixture,
  diapositivas: graphFixture.diapositivas.map((slide, index) => ({ ...slide,
    aristas: slide.aristas.map(edge => edge.estilo === "solido" ? `${edge.desde} -> ${edge.hacia}` : edge),
    posiciones: index === 0 ? {
      D: { fila: 1, columna: 5, estado: "alerta" }, A: { fila: 3, columna: 3, estado: "normal" },
      E: { fila: 3, columna: 8, estado: "atenuado" }, B: { fila: 5, columna: 2, estado: "normal" }, C: { fila: 5, columna: 4, estado: "normal" },
    } : {
      A: { fila: 1, columna: 5, estado: "exito" }, D: { fila: 3, columna: 7, estado: "normal" },
      B: { fila: 3, columna: 3, estado: "normal" }, C: { fila: 5, columna: 6, estado: "destacado" }, E: { fila: 5, columna: 8, estado: "normal" },
    },
    comentarios: slide.comentarios.map(comment => ({ anclado_a: comment.anclado_a, texto: comment.texto, color: comment.color, posicion: "arriba-derecha" })),
  })),
}
