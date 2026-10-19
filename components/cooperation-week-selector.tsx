'use client'
import { useEffect, useState } from 'react'
import { toggleCooperationWeek } from '@/lib/client/cooperation'
import type { WeekSelection } from '@/lib/client/cooperation-selection'

export function CooperationWeekSelector({ sphereId, selection, weekNumber, onNavigate }: {
  sphereId: string; selection: WeekSelection; weekNumber: number; onNavigate: (direction: -1 | 1) => void
}) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const selected = !selection.excludedWeeks.includes(weekNumber)
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return
      if (event.key !== '<' && event.key !== '>') return
      event.preventDefault(); onNavigate(event.key === '<' ? -1 : 1)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onNavigate])
  return <div data-cooperation-selection-control className="z-30 flex shrink-0 flex-col items-center gap-2 border-b pb-3">
    <div className="flex items-center justify-center gap-3">
      <button type="button" aria-label="Semana anterior" disabled={!selection.weeks.some(w => w < weekNumber)} onClick={() => onNavigate(-1)} className="rounded-full border px-3 py-2 disabled:opacity-25">&lt;</button>
      <button type="button" disabled={busy || !selection.weeks.length} aria-pressed={selected && selection.weeks.length > 0} onClick={async () => {
        setBusy(true); setError('')
        try { await toggleCooperationWeek(sphereId, weekNumber) } catch (error) { setError((error as Error).message) }
        finally { setBusy(false) }
      }} className={`min-w-44 rounded-xl border px-5 py-2 text-lg font-medium ${selected ? 'border-green-600 bg-green-600 text-white' : 'bg-muted text-muted-foreground'}`}>
        {selected ? '✓' : '○'} Sincronizar <span className="block text-xs font-normal">{selection.weeks.length ? `Semana ${weekNumber}` : 'Sin semanas todavía'}</span>
      </button>
      <button type="button" aria-label="Semana siguiente" disabled={!selection.weeks.some(w => w > weekNumber)} onClick={() => onNavigate(1)} className="rounded-full border px-3 py-2 disabled:opacity-25">&gt;</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>
}
