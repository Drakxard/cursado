import { z } from "zod"
import { StructuredLessonError } from "./pdf-explanation-structured.ts"

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)
const state = z.enum(["normal", "alerta", "exito", "destacado", "atenuado"])
export const graphNodeDataSchema = z.array(z.object({ etiqueta: z.string().trim().min(1).max(40), valor: z.string().trim().min(1).max(120) }).strict()).max(4)
export const gridPositionSchema = z.object({ fila: z.number().int().min(1).max(6), columna: z.number().int().min(1).max(10), estado: state, datos: graphNodeDataSchema.nullish() }).strict()
export const pixelPositionSchema = z.object({ x: z.number().finite().min(50).max(950), y: z.number().finite().min(50).max(440), estado: state, datos: graphNodeDataSchema.nullish() }).strict()
const commentFields = { anclado_a: id, color: z.enum(["rojo", "verde", "amarillo", "azul"]), texto: z.string().trim().min(1).max(600) }
export const relativeCommentSchema = z.object({ ...commentFields,
  posicion: z.enum(["arriba-derecha", "arriba-izquierda", "abajo-derecha", "abajo-izquierda", "arriba", "abajo", "derecha", "izquierda"]),
}).strict()
const offsetCommentSchema = z.object({ ...commentFields, offset_x: z.number().finite().min(-1000).max(1000), offset_y: z.number().finite().min(-560).max(560) }).strict()
export const graphEdgeSchema = z.object({ desde: id, hacia: id, estilo: z.enum(["solido", "animado_verde", "animado_amarillo"]), etiqueta: z.string().trim().max(80).nullish(), dirigida: z.boolean().nullish() }).strict()
const edgeSchema = graphEdgeSchema
export const topologyEdgeSchema = z.string().max(166).regex(/^[A-Za-z0-9_-]{1,80}\s*->\s*[A-Za-z0-9_-]{1,80}$/)
export const graphPresentationSchema = z.object({
  plantilla: z.literal("pantilla1_grafos"),
  titulo: z.string().trim().min(1).max(300),
  elementos_iniciales: z.array(z.object({
    id, tipo: z.enum(["nodo", "subarbol"]), etiqueta: z.string().trim().min(1).max(120), datos: graphNodeDataSchema.nullish(),
  }).strict()).min(1).max(40),
  diapositivas: z.array(z.object({
    paso: z.number().int().min(1).max(12),
    posiciones: z.record(id, z.union([gridPositionSchema, pixelPositionSchema])),
    aristas: z.array(z.union([edgeSchema, topologyEdgeSchema])).max(100),
    comentarios: z.array(z.union([relativeCommentSchema, offsetCommentSchema])).max(12),
  }).strict()).min(1).max(12),
}).strict()

export type GraphPresentation = z.infer<typeof graphPresentationSchema>
const slideSchema = graphPresentationSchema.shape.diapositivas.element
export const graphGenerationSchema = graphPresentationSchema.extend({ diapositivas: z.array(slideSchema.extend({
  posiciones: z.record(id, gridPositionSchema), comentarios: z.array(relativeCommentSchema).max(12),
})).min(1).max(12) })
type PixelPosition = z.infer<typeof pixelPositionSchema>
export type ResolvedGraphPresentation = Omit<GraphPresentation, "diapositivas"> & {
  diapositivas: (Omit<GraphPresentation["diapositivas"][number], "posiciones" | "aristas"> & { posiciones: Record<string, PixelPosition>; aristas: z.infer<typeof edgeSchema>[] })[]
}

export function resolveGraphPresentation(input: unknown): ResolvedGraphPresentation {
  const parsed = graphPresentationSchema.safeParse(input)
  const fail = (message: string): never => { throw new StructuredLessonError(message) }
  if (!parsed.success) return fail(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "))
  const data = { ...parsed.data, diapositivas: parsed.data.diapositivas.map(slide => ({ ...slide,
    aristas: slide.aristas.map(edge => {
      if (typeof edge !== "string") return edge
      const [desde, hacia] = edge.split(/\s*->\s*/)
      return { desde, hacia, estilo: "solido" as const }
    }),
  })) }
  if (JSON.stringify(data).length > 200_000) fail("La presentación supera el tamaño permitido.")
  const ids = new Set(data.elementos_iniciales.map(element => element.id))
  if (ids.size !== data.elementos_iniciales.length) fail("Elementos con identificadores duplicados.")
  data.diapositivas.forEach((slide, index) => {
    if (slide.paso !== index + 1) fail("Los pasos deben ser consecutivos desde 1.")
    if (Object.keys(slide.posiciones).length !== ids.size || [...ids].some(id => !Object.hasOwn(slide.posiciones, id))) fail(`Paso ${slide.paso}: posiciones deben incluir exactamente todos los elementos.`)
    const edges = new Set<string>()
    for (const edge of slide.aristas) {
      if (!ids.has(edge.desde) || !ids.has(edge.hacia)) fail(`Paso ${slide.paso}: conexión a un elemento inexistente.`)
      const key = `${edge.desde}:${edge.hacia}`
      if (edges.has(key)) fail(`Paso ${slide.paso}: conexión duplicada.`)
      edges.add(key)
    }
    if (slide.comentarios.some(comment => !ids.has(comment.anclado_a))) fail(`Paso ${slide.paso}: comentario anclado a un elemento inexistente.`)
  })
  const resolved = { ...data, diapositivas: data.diapositivas.map(slide => ({ ...slide,
    posiciones: Object.fromEntries(Object.entries(slide.posiciones).map(([id, p]) => [id,
      "fila" in p ? { x: 50 + (p.columna - 1) * 100, y: 50 + (p.fila - 1) * 78, estado: p.estado, ...("datos" in p ? { datos: p.datos } : {}) } : p,
    ])),
  })) }
  resolved.diapositivas.forEach((slide, index) => {
    if (!Object.values(data.diapositivas[index].posiciones).some(p => "fila" in p)) return
    const boxes = data.elementos_iniciales.map(element => {
      const p = slide.posiciones[element.id], subtree = element.tipo === "subarbol"
      return { id: element.id, left: p.x - (subtree ? 42 : 36), right: p.x + (subtree ? 42 : 36), top: p.y - 36, bottom: p.y + (subtree ? 92 : 36) }
    })
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const x = boxes[a], y = boxes[b]
      if (x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top) fail(`Paso ${slide.paso}: elementos ${x.id} y ${y.id} superpuestos; elegí otras celdas de la grilla.`)
    }
  })
  return resolved
}

export const GRAPH_PRESENTATION_INSTRUCTIONS = `Para explicar árboles, grafos o sus transformaciones, preferí plantilla "pantilla1_grafos": titulo, elementos_iniciales [{id,tipo:"nodo"|"subarbol",etiqueta}] y diapositivas [{paso,posiciones,aristas,comentarios}].
Representá conceptos, procesos, redes y dependencias con las mismas herramientas: el formato no está limitado a árboles. En elementos_iniciales usá datos:[{etiqueta,valor}] para mostrar hasta cuatro atributos del nodo (por ejemplo costo, estado, cantidad, clave o prioridad); ambos campos son texto. datos:[] si no hacen falta. Cada posición también admite datos para mostrar valores que cambian en ese paso; null conserva los datos base. Los IDs son internos: los comentarios deben referirse a las etiquetas y valores visibles.
Cada paso incluye posiciones de TODOS los elementos, con IDs estables: {fila,columna,estado}. Grilla de 10 columnas y 6 filas, índices enteros desde 1. Nunca calcules píxeles ni offsets. No ocupes una misma celda con dos elementos; debajo de un subarbol dejá una fila libre en su columna, porque su triángulo ocupa espacio. Estados: normal, alerta, exito, destacado, atenuado.
Aristas: strings como "A -> B" para conexiones sólidas; para destacar usá {desde,hacia,estilo:"solido"|"animado_verde"|"animado_amarillo"}. Solo declarás topología y estilo; el motor calcula las líneas. Comentarios: {anclado_a,posicion,color:"rojo"|"verde"|"amarillo"|"azul",texto}; posicion puede ser arriba-derecha, arriba-izquierda, abajo-derecha, abajo-izquierda, arriba, abajo, derecha o izquierda. Pasos consecutivos desde 1, máximo 12; usá arrays vacíos cuando corresponda.
Las aristas en objeto también admiten etiqueta (texto breve de la relación o comparación; null si no hace falta) y dirigida (true para flecha, false o null para conexión sin flecha). No deduzcas direcciones que el material no justifique.
Construí una secuencia didáctica: situación inicial, recorrido o comparación, transformación y comprobación, según el tema. Mostrá cada cambio mediante posiciones, conexiones, estados o datos distintos; un paso nuevo no debe ser solo otro párrafo cuando hay un cambio visual que mostrar. Conservá IDs entre pasos. Resaltá únicamente los protagonistas del cambio; para un panorama general usá normal. Usá uno o dos comentarios breves por paso; evitá trasladar toda la explicación a texto. No inventes alturas ni factores de balance de subárboles desconocidos. El JSON describe datos, nunca código, SVG ni estilos CSS.`
