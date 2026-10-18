import { z } from "zod"
import { structuredLessonSchema } from "./pdf-explanation-structured.ts"
import { graphPresentationSchema, graphGenerationSchema, gridPositionSchema, pixelPositionSchema, graphNodeDataSchema, graphEdgeSchema, topologyEdgeSchema } from "./pdf-explanation-graphs.ts"

export const explanationFormatSchema = z.union([structuredLessonSchema, graphGenerationSchema])
// Strict provider schemas require an object root and fixed object properties.
// Represent the dynamic position map as entries on this wire only.
const slide = graphGenerationSchema.shape.diapositivas.element
const positionId = graphPresentationSchema.shape.elementos_iniciales.element.shape.id
const azureEdge = graphEdgeSchema.extend({ etiqueta: z.string().trim().max(80).nullable(), dirigida: z.boolean().nullable() })
const azureGraphSchema = graphGenerationSchema.extend({
  elementos_iniciales: z.array(graphGenerationSchema.shape.elementos_iniciales.element.extend({ datos: graphNodeDataSchema.nullable() })).min(1).max(40),
  diapositivas: z.array(slide.extend({
    titulo: z.string().trim().min(1).max(120),
    objetivo: z.string().trim().min(1).max(300),
    posiciones: z.array(gridPositionSchema.extend({ id: positionId, datos: graphNodeDataSchema.nullable() })).min(1).max(40),
    aristas: z.array(z.union([azureEdge, topologyEdgeSchema])).max(100),
  })).min(1).max(12),
})
export const azureExplanationFormatSchema = z.object({
  lesson: z.union([structuredLessonSchema, azureGraphSchema]),
}).strict()
const legacySlide = graphPresentationSchema.shape.diapositivas.element
const compatibleAzureGraphSchema = graphPresentationSchema.extend({ diapositivas: z.array(legacySlide.extend({
  posiciones: z.array(z.union([gridPositionSchema.extend({ id: positionId }), pixelPositionSchema.extend({ id: positionId })])).min(1).max(40),
})).min(1).max(12) })
const azureDecodeSchema = z.object({ lesson: z.union([structuredLessonSchema, compatibleAzureGraphSchema]) }).strict()

export function decodeAzureExplanation(input: unknown): unknown {
  if (!input || typeof input !== "object" || !("lesson" in input)) return input
  const { lesson } = azureDecodeSchema.parse(input)
  if ("plantilla" in lesson) return { ...lesson, diapositivas: lesson.diapositivas.map(slide => {
    const positions = Object.fromEntries(slide.posiciones.map(({ id, ...position }) => [id, position]))
    if (Object.keys(positions).length !== slide.posiciones.length) throw new Error("Posiciones con identificadores duplicados.")
    return { ...slide, posiciones: positions }
  }) }
  return lesson
}
