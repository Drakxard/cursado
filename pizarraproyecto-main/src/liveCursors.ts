type Cursor = { clientId: string; userId: string; updated: number }
type User = { id: string; client_ids?: string[] }

export function reconcileCursors<T extends Cursor>(cursors: Map<string, T>, users: User[], self?: string | null) {
  for (const [key, cursor] of cursors) {
    const user = users.find(user => user.id === cursor.userId)
    if (!user || user.id === self || (user.client_ids && !user.client_ids.includes(cursor.clientId))) cursors.delete(key)
  }
}

// A person can arrive through both a board link and a cooperative room.
// Display their latest position once, including while an old socket is closing.
export function updateCursor<T extends Cursor>(cursors: Map<string, T>, cursor: T, self?: string | null) {
  if (cursor.userId === self) return
  for (const [key, previous] of cursors) if (previous.userId === cursor.userId) cursors.delete(key)
  cursors.set(cursor.clientId, cursor)
}

export function expireCursors<T extends Cursor>(cursors: Map<string, T>, now = Date.now()) {
  const size = cursors.size
  for (const [key, cursor] of cursors) if (now - cursor.updated > 10_000) cursors.delete(key)
  return size !== cursors.size
}
