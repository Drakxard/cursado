/** The link grants the current transitive closure, never an entire workspace. */
export function reachableBoards(root: string, edges: (id: string) => string[]): Set<string> {
  const found = new Set<string>(), queue = [root]
  while (queue.length) {
    const id = queue.pop()!
    if (found.has(id)) continue
    found.add(id)
    queue.push(...edges(id).filter(next => !found.has(next)))
  }
  return found
}

export function boardTargets(content: any): string[] {
  return [...new Set<string>((content?.shapes ?? []).filter((shape: any) => shape.visualType === 'board-shortcut' && !shape.sharedUnavailable && typeof shape.boardReference?.boardId === 'string').map((shape: any) => shape.boardReference.boardId))]
}

export function validBoardContent(value: any): boolean {
  return !!value && typeof value === 'object' && ['strokes', 'texts', 'media'].every(key => Array.isArray(value[key])) &&
    ['shapes', 'tables', 'graphs', 'videos'].every(key => value[key] === undefined || Array.isArray(value[key])) &&
    (value.shapes ?? []).every((shape: any) => shape && typeof shape.id === 'string') &&
    value.strokes.every((stroke:any)=>stroke && Array.isArray(stroke.points)) &&
    value.texts.every((text:any)=>text && typeof text.id==='string' && typeof text.text==='string') &&
    value.media.every((media:any)=>media && typeof media.id==='string' && typeof media.assetId==='string' && typeof media.name==='string')
}
