"use client"

import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

import { cn } from "@/lib/utils"
import { SubjectVoiceImages, type VoiceImagesHandle } from "@/components/subject-voice-images"
import { VoiceModeButton } from "./voice-mode-button"
export { VoiceModeButton } from "./voice-mode-button"

export function SubjectVoiceDialog({ subject, onClose, weekNumber }: {
  subject: { id: string; name: string } | null
  onClose: () => void
  weekNumber?: number
}) {
  const [pdfViewing, setPdfViewing] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const imagesRef = useRef<VoiceImagesHandle>(null)

  return (
    <Dialog open={Boolean(subject)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing || imagesRef.current?.escape()) event.preventDefault()
        }}
        onKeyDown={(event) => {
          if (event.key !== "Backspace" || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return
          const target = event.target as HTMLElement
          if (target.closest("input, textarea, select, [contenteditable]") && !(target instanceof HTMLInputElement && target.hasAttribute("data-voice-search") && target.value === "")) return
          event.preventDefault()
          if (!imagesRef.current?.escape()) onClose()
        }}
        className="subject-voice-handwriting inset-0 top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-white p-0 text-black shadow-none sm:max-w-none"
      >
        <div className={cn("pointer-events-none absolute inset-x-5 top-5 z-30 flex items-start justify-between gap-5 sm:inset-x-8 sm:top-8", pdfViewing && "justify-end", editorOpen && "hidden")}>
          <DialogTitle className={pdfViewing ? "sr-only" : "max-w-[calc(100%_-_5rem)] rounded bg-white/95 px-1 py-1 text-2xl leading-tight font-normal sm:text-[32px]"}>
            {subject?.name}
          </DialogTitle>
          <VoiceModeButton active={false} label="Buscar en PDF" onClick={() => imagesRef.current?.focusSearch()} />
        </div>
        <DialogDescription className="sr-only">
          Audios y búsqueda para {subject?.name}. Escribí para buscar en PDF. Pulsá + para grabar. Escape o Backspace vuelven un nivel.
        </DialogDescription>
        {subject && <SubjectVoiceImages key={`${subject.id}:${weekNumber ?? "current"}`} subjectId={subject.id} weekNumber={weekNumber} ref={imagesRef} onPdfViewing={setPdfViewing} onEditorChange={setEditorOpen} />}
      </DialogContent>
    </Dialog>
  )
}
