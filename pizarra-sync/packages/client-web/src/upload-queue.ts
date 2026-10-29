type Options = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  maxRequests?: number
  windowMs?: number
  attempts?: number
}

export function retryDelay(value: string | null, now: number, fallback: number) {
  if (!value) return fallback
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(delay) ? Math.max(250, delay) : fallback
}

// The existing Worker permits 30 uploads per IP/minute. Leave room for other tabs,
// serialize local uploads and honor the server's limit if another client uses it.
export function createUploadQueue(options: Options = {}) {
  const request = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now, windowMs = options.windowMs ?? 60000
  const maxRequests = options.maxRequests ?? 24, attempts = options.attempts ?? 4
  const timestamps: number[] = []
  let tail: Promise<unknown> = Promise.resolve()
  return (url: string, init: RequestInit, onWait?: (ms: number) => void): Promise<Response> => {
    const run = async () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        while (timestamps.length && now() - timestamps[0]! >= windowMs) timestamps.shift()
        if (timestamps.length >= maxRequests) {
          const delay = Math.max(1, timestamps[0]! + windowMs - now())
          onWait?.(delay); await sleep(delay)
          while (timestamps.length && now() - timestamps[0]! >= windowMs) timestamps.shift()
        }
        timestamps.push(now()); onWait?.(0)
        let response: Response
        try { response = await request(url, init) }
        catch (error) {
          if (attempt === attempts - 1) throw error
          const delay = 1000 * 2 ** attempt; onWait?.(delay); await sleep(delay); continue
        }
        if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
          const delay = retryDelay(response.headers.get('Retry-After'), now(), response.status === 429 ? 60000 : 1000 * 2 ** attempt)
          await response.body?.cancel().catch(() => {})
          onWait?.(delay); await sleep(delay); continue
        }
        return response
      }
      throw new Error('No se pudo completar la subida.')
    }
    const result = tail.then(run)
    tail = result.catch(() => {})
    return result
  }
}
