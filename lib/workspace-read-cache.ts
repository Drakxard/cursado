/** Bounded cache for derived views, never for read/modify/write manifests. */
export class WorkspaceReadCache {
  private entries = new Map<string, { promise: Promise<unknown>; expires: number }>()
  private root: object | null = null
  private ttl: number
  private limit: number

  constructor(ttl = 30_000, limit = 128) {
    this.ttl = ttl
    this.limit = limit
  }

  clear() { this.entries.clear() }

  async read<T>(root: object, key: string, load: () => Promise<T>): Promise<T> {
    if (root !== this.root) { this.clear(); this.root = root }
    let entry = this.entries.get(key)
    if (!entry || entry.expires <= Date.now()) {
      const next = { promise: Promise.resolve().then(load), expires: Infinity }
      entry = next
      this.entries.set(key, next)
      while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
      void next.promise.then(() => {
        next.expires = Date.now() + this.ttl
      }, () => {
        if (this.entries.get(key) === next) this.entries.delete(key)
      })
    }
    // Consumers may change their view objects; keep the cached snapshot private.
    return structuredClone(await entry.promise) as T
  }
}
