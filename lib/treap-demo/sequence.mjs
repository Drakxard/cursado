import { z } from 'zod'
import { createTreeModel } from './operations.mjs'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/)
const tree = z.object({ root: id.nullable(), children: z.record(z.tuple([id.nullable(), id.nullable()])) }).strict()
const operation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observe') }).strict(),
  z.object({ type: z.literal('show'), tree }).strict(),
  z.object({ type: z.literal('insert'), node: id }).strict(),
  z.object({ type: z.literal('rotateLeft'), pivot: id }).strict(),
  z.object({ type: z.literal('rotateRight'), pivot: id }).strict(),
  z.object({ type: z.literal('check') }).strict(),
])
export const sequenceSchema = z.object({
  version: z.literal(1),
  catalog: z.array(z.object({ id, key: z.number().finite(), priority: z.number().finite() }).strict()).max(64),
  initial: tree,
  steps: z.array(z.object({
    title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(1200),
    badge: z.string().trim().min(1).max(200), operation,
    focus: z.array(id).max(64).default([]),
  }).strict()).min(1).max(40),
}).strict()

// Compile the entire sequence before rendering: a bad later step cannot leave
// a partially accepted lesson on screen. Author prose is never executed.
export function compileSequence(input) {
  const parsed = sequenceSchema.safeParse(input)
  if (!parsed.success) throw new Error(`Secuencia inválida: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const lesson = parsed.data, model = createTreeModel(lesson.catalog)
  model.inspect(lesson.initial)
  let current = structuredClone(lesson.initial)
  const steps = lesson.steps.map((step, index) => {
    try {
      const op = step.operation
      if (op.type === 'show') { model.inspect(op.tree); current = structuredClone(op.tree) }
      if (op.type === 'insert') current = model.insert(current, op.node)
      if (op.type === 'rotateLeft' || op.type === 'rotateRight') current = model[op.type](current, op.pivot)
      const report = model.inspect(current)
      if (op.type === 'check' && report.violations.length) throw new Error('La comprobación falla: hay conflictos de prioridad.')
      if (step.focus.some(node => !Object.hasOwn(current.children, node))) throw new Error('El foco referencia un nodo que no está en el árbol.')
      return { ...step, tree: structuredClone(current), danger: report.violations.length > 0, success: op.type === 'check' }
    } catch (error) { throw new Error(`Paso ${index + 1}: ${error.message}`) }
  })
  return { catalog: lesson.catalog, steps }
}
