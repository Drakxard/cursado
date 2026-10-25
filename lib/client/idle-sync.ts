// Only schedules remote work; local persistence remains immediate.
export const SOLO_SYNC_INTERVAL_MS = 60 * 60_000
export const SOLO_SYNC_IDLE_MS = 10 * 60_000
export const LIVE_SYNC_DELAY_MS = 250

export function createIdleSync(options: {
  run: () => Promise<unknown>
  isLive?: () => boolean
  onError?: (error: unknown) => void
  target?: EventTarget
  storageKey?: string
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}) {
  let pending = false, running = false, stopped = false
  let activityAt = Date.now(), requestedAt = activityAt
  let nextHourlyAt = activityAt + SOLO_SYNC_INTERVAL_MS
  let recovery = false, version = ''
  const storage = () => options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  try {
    version = options.storageKey ? storage()?.getItem(options.storageKey) || '' : ''
    pending = recovery = Boolean(version)
  } catch { /* Local files remain the source of truth if storage is unavailable. */ }
  const markPending = () => {
    version = `${Date.now()}:${Math.random()}`
    try { if (options.storageKey) storage()?.setItem(options.storageKey, version) } catch {}
  }
  const clearPending = () => {
    try {
      if (options.storageKey && storage()?.getItem(options.storageKey) === version) storage()?.setItem(options.storageKey, '')
    } catch {}
  }
  let retryAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const target = options.target ?? (typeof window !== 'undefined' ? window : undefined)
  const events = ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart']
  const delay = () => options.isLive?.()
    ? Math.max(0, requestedAt + LIVE_SYNC_DELAY_MS - Date.now())
    : Math.max(0, (recovery ? Math.max(activityAt, requestedAt) + SOLO_SYNC_IDLE_MS : nextHourlyAt) - Date.now())
  const remaining = () => Math.max(delay(), retryAt - Date.now())
  const arm = () => {
    clearTimeout(timer)
    if (!stopped && pending && !running) timer = setTimeout(check, remaining())
  }
  const check = async () => {
    timer = undefined
    if (stopped || !pending || running) return
    if (remaining() > 0) { arm(); return }
    const live = options.isLive?.()
    if (recovery) {
      recovery = false
      nextHourlyAt = Date.now() + SOLO_SYNC_INTERVAL_MS
    } else if (!live) {
      nextHourlyAt += (Math.floor((Date.now() - nextHourlyAt) / SOLO_SYNC_INTERVAL_MS) + 1) * SOLO_SYNC_INTERVAL_MS
    }
    pending = false; running = true
    try {
      // A deferred/offline run is not a successful upload.
      const result = await options.run()
      if (result === false) pending = true
      else if (!pending) clearPending()
      retryAt = result === false && live ? Date.now() + SOLO_SYNC_IDLE_MS : 0
    }
    catch (error) {
      pending = true; retryAt = live ? Date.now() + SOLO_SYNC_IDLE_MS : 0
      options.onError?.(error)
    } finally { running = false; arm() }
  }
  const activity = () => { activityAt = Date.now() }
  for (const event of events) target?.addEventListener(event, activity, { passive: true })
  if (pending) arm()
  return {
    request() {
      if (stopped) return
      // Saves never postpone the fixed hourly deadline.
      if (!pending && nextHourlyAt < Date.now()) {
        nextHourlyAt += Math.ceil((Date.now() - nextHourlyAt) / SOLO_SYNC_INTERVAL_MS) * SOLO_SYNC_INTERVAL_MS
      }
      pending = true; requestedAt = Date.now(); markPending(); arm()
    },
    refresh: arm,
    stop() {
      stopped = true; clearTimeout(timer)
      for (const event of events) target?.removeEventListener(event, activity)
    },
  }
}
