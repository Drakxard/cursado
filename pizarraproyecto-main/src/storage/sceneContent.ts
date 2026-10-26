type Content = { [key: string]: unknown }
const lists = ['strokes', 'texts', 'media', 'shapes', 'tables', 'graphs', 'videos']
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const keyed = (items: unknown[]): items is ({ id: string } & Record<string, unknown>)[] => items.every(item => object(item) && typeof item.id === 'string') && new Set(items.map(item => (item as {id:string}).id)).size === items.length

/** Retain object and nested prop identities so an unrelated edit does not
 * restart Plotly, media players or inline editors. Incoming data stays immutable. */
export function shareUnchanged<T>(current: T, incoming: T): T {
  if (current === incoming || equal(current, incoming)) return current
  if (Array.isArray(current) && Array.isArray(incoming)) {
    const byId = keyed(current) && keyed(incoming) ? new Map(current.map(item => [item.id, item])) : null
    return incoming.map((item, index) => shareUnchanged(byId ? byId.get(item.id) : current[index], item)) as T
  }
  if (object(current) && object(incoming)) {
    return Object.fromEntries(Object.entries(incoming).map(([key, value]) => [key, shareUnchanged(current[key], value)])) as T
  }
  return incoming
}

export function reconcileRemoteScene<T extends Content>(current: T, incoming: Content): T {
  const result = { ...current }
  for (const key of lists) {
    const next = key === 'videos' ? incoming.videos ?? (incoming.camera as {youtubeVideos?:unknown[]})?.youtubeVideos ?? [] : incoming[key] ?? []
    Object.assign(result, { [key]: shareUnchanged(current[key] ?? [], next) })
  }
  return result
}

/** Rebase personal undo snapshots over remote edits. Only properties changed
 * remotely are propagated; undo must not remove someone else's new objects. */
function rebaseValue(history: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return history
  if (after === undefined) return undefined
  if (before === undefined || history === undefined) return structuredClone(after)
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(history) && keyed(before) && keyed(after) && keyed(history)) {
    const old = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]))
    const result = history.filter(item => !old.has(item.id) || next.has(item.id)).map(item => next.has(item.id) ? rebaseValue(item, old.get(item.id), next.get(item.id)) : item)
    const ids = new Set(history.map(item => item.id))
    for (const item of after) if (!ids.has(item.id) && !equal(old.get(item.id), item)) result.push(structuredClone(item))
    return result
  }
  if (object(before) && object(after) && object(history)) {
    const result = { ...history }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (equal(before[key], after[key])) continue
      const value = rebaseValue(history[key], before[key], after[key])
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  return structuredClone(after)
}

export function rebaseRemoteHistory<T extends Content>(history: T[], before: Content, after: Content): T[] {
  return history.map(entry => {
    const result = { ...entry }
    for (const key of lists) Object.assign(result, { [key]: rebaseValue(entry[key] ?? [], before[key] ?? [], after[key] ?? []) })
    return result
  })
}

// Camera and transport versions are personal/session metadata, not scene edits.
export function sameBoardScene(a: Content, b: Content) {
  const value = (content: Content, key: string) => key === 'videos'
    ? content.videos ?? (content.camera as {youtubeVideos?:unknown[]})?.youtubeVideos ?? []
    : content[key] ?? []
  return lists.every(key => JSON.stringify(value(a, key)) === JSON.stringify(value(b, key)))
}
