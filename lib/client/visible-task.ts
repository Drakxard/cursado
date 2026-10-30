/** Periodic UI work sleeps while hidden; one refresh runs when the page returns. */
export function startVisibleTask(run: () => void | Promise<unknown>, intervalMs: number, visibility = typeof document !== 'undefined' ? document : undefined) {
  let stopped = false, running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    if (!stopped && !running && visibility?.visibilityState !== 'hidden') timer = setTimeout(tick, intervalMs)
  }
  const tick = async () => {
    clearTimeout(timer); timer = undefined
    if (stopped || running || visibility?.visibilityState === 'hidden') return
    running = true
    try { await run() } finally { running = false; schedule() }
  }
  const changed = () => {
    clearTimeout(timer)
    if (visibility?.visibilityState !== 'hidden') void tick()
  }
  visibility?.addEventListener('visibilitychange', changed)
  schedule()
  return () => { stopped = true; clearTimeout(timer); visibility?.removeEventListener('visibilitychange', changed) }
}
