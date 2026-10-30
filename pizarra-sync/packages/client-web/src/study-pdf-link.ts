import type { TextRun } from '@komuboard/shared'

// The text owns the label; the PDF attachment owns its destination.
export function studyPdfRuns(id: string, runs: TextRun[]): TextRun[] {
  const url = new URL('/estudio', location.origin)
  url.hash = `pdf=${encodeURIComponent(id)}`
  return runs.map(run => ({ ...run, link: url.href }))
}
