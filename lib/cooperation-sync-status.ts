type SyncMirror = {
  binding: { id: string; subjectId: string }
  error?: string
  outbox?: unknown
  incoming?: unknown
  downloading?: boolean
  selection?: { choosing?: boolean }
  transfer?: { completed: number; total: number }
}

export function cooperationSyncLabel(subjectId: string, mirrors: SyncMirror[], confirmed: ReadonlySet<string>, online: boolean): string | null {
  const matching = mirrors.filter(mirror => mirror.binding.subjectId === subjectId)
  if (!matching.length) return null
  if (!online || matching.some(mirror => mirror.error)) return '???'
  const percentages = matching.map(mirror => {
    if (mirror.selection?.choosing) return null
    if (mirror.transfer && mirror.transfer.total > 0) return Math.min(99, Math.max(0, Math.floor(100 * mirror.transfer.completed / mirror.transfer.total)))
    if (mirror.outbox || mirror.incoming || mirror.downloading || !confirmed.has(mirror.binding.id)) return null
    return 100
  })
  return percentages.some(value => value === null) ? null : `${Math.min(...percentages as number[])}%`
}
