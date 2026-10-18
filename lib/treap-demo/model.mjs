import lesson from './example.json' with { type: 'json' }
import { compileSequence } from './sequence.mjs'
import { createTreeModel } from './operations.mjs'

export const { catalog, steps } = compileSequence(lesson)
export const initial = lesson.steps[1].operation.tree
export const { insert, rotateLeft, rotateRight, inspect } = createTreeModel(catalog)
