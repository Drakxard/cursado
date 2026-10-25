import { all, create } from 'mathjs'

// These tools use the same default configuration. Construct the engine only on
// the first calculation, and share it without changing its global configuration.
let engine: ReturnType<typeof create> | undefined
export function getMathEngine() {
  return engine ??= create(all, {})
}
