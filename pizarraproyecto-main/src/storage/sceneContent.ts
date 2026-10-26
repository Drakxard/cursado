type Content = { [key: string]: unknown }
const lists = ['strokes', 'texts', 'media', 'shapes', 'tables', 'graphs', 'videos']

// Camera and transport versions are personal/session metadata, not scene edits.
export function sameBoardScene(a: Content, b: Content) {
  const value = (content: Content, key: string) => key === 'videos'
    ? content.videos ?? (content.camera as {youtubeVideos?:unknown[]})?.youtubeVideos ?? []
    : content[key] ?? []
  return lists.every(key => JSON.stringify(value(a, key)) === JSON.stringify(value(b, key)))
}
