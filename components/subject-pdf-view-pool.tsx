"use client"

import { useRef } from "react"
import { SubjectPdfFragment } from "./subject-pdf-fragment"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"

const keyFor = (result: PdfSearchResult) => JSON.stringify([result.id, result.fileId, result.query, result.title, result.candidate, result.decision])

export function SubjectPdfViewPool({ active, subjectId, onBack, onUndo, onSearchAgain }: {
  candidates: PdfSearchResult[]; active: PdfSearchResult | null; subjectId: string;
  onBack: () => void; onUndo: () => void; onSearchAgain: () => void
}) {
  const positions = useRef({ subjectId, values: new Map<string, number>() })
  if (positions.current.subjectId !== subjectId) positions.current = { subjectId, values: new Map() }
  if (!active) return null
  const key = keyFor(active)
  return <div key={key} data-pdf-active={active.id}
    style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", flexDirection: "column" }}>
    <SubjectPdfFragment result={active} subjectId={subjectId} active initialScrollTop={positions.current.values.get(key)}
      onScrollPosition={top => {
        positions.current.values.set(key, top)
        if (positions.current.values.size > 50) positions.current.values.delete(positions.current.values.keys().next().value!)
      }} onBack={onBack} onUndo={onUndo} onSearchAgain={onSearchAgain} />
  </div>
}
