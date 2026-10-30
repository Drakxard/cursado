import { startCooperationBackground } from './cooperation.ts'
import { mergeCooperation } from '../cooperation-model.ts'

// PDF.js is a standalone page; use the same durable local mirror as Study.
Object.assign(window, { cursadoMergeCooperation: mergeCooperation })
if (!new URLSearchParams(location.search).has('native')) {
  const stop = startCooperationBackground()
  window.addEventListener('pagehide', stop, { once: true })
  // Pending deletions are reviewed from Study. Sync must not interrupt reading.
}
