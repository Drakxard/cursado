const queues = new Map<string, Promise<unknown>>()

/** Coordinate local saves and cooperative writes, including across browser tabs. */
export function withWorkspaceFileLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const name = `cursado-workspace:${key}`
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, work)
  const previous = queues.get(name) || Promise.resolve()
  const result = previous.catch(() => {}).then(work)
  queues.set(name, result)
  return result.finally(() => { if (queues.get(name) === result) queues.delete(name) })
}
