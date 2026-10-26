"use client"

import { Mic } from "lucide-react"
import { cn } from "@/lib/utils"
import { useVoiceLongPress } from "@/hooks/use-voice-long-press"

export function VoiceModeButton({ active, label, onClick, onLongPress }: {
  active: boolean
  label: string
  onClick: () => void
  onLongPress?: () => void
}) {
  const longPress = useVoiceLongPress(onLongPress)
  return <button type="button" aria-label={label} aria-pressed={active} title={label}
    onClick={onClick} {...longPress}
    aria-description={onLongPress ? "Mantené presionado para probar voces en español." : undefined}
    className={cn(
      "pointer-events-auto flex h-12 w-12 shrink-0 touch-manipulation select-none items-center justify-center rounded-full bg-[#c7c7c7] text-black transition-colors hover:bg-[#b9b9b9] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:h-16 sm:w-16",
      active && "bg-[#b8d3c3] ring-2 ring-[#528169] ring-offset-2 hover:bg-[#a9c7b5]"
    )}>
    <Mic aria-hidden="true" className="h-6 w-6 fill-current sm:h-8 sm:w-8" strokeWidth={2.5} />
  </button>
}
