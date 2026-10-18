import { z } from "zod"
import { structuredLessonSchema } from "./pdf-explanation-structured.ts"
import { graphPresentationSchema, graphGenerationSchema, gridPositionSchema, pixelPositionSchema } from "./pdf-explanation-graphs.ts"

export const explanationFormatSchema = z.union([structuredLessonSchema, graphGenerationSchema])
// Strict provider schemas require an object root and fixed object properties.
// Represent the dynamic position map as entries on this wire only.
const slide = graphGenerationSchema.shape.diapositivas.element
const positionId = graphPresentationSchema.shape.elementos_iniciales.element.shape.id
const azureGraphSchema = graphGenerationSchema.extend({
  diapositivas: z.array(slide.extend({
    posiciones: z.array(gridPositionSchema.extend({ id: positionId })).min(1).max(40),
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
