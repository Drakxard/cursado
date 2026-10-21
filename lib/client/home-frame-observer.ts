// Observe frame lifetimes without rescanning PDF content on every DOM update.
export function observeHomeFrames(root: Window, attach: (current: Window) => () => void) {
  const attached = new Map<Document, () => void>()
  let stopped = false, queued = false
  const schedule = () => {
    if (stopped || queued) return
    queued = true
    queueMicrotask(() => { queued = false; if (!stopped) scan() })
  }
  const containsFrame = (node: Node) => node.nodeType === 1 && (
    (node as Element).localName === 'iframe' || Boolean((node as Element).querySelector('iframe'))
  )
  const scan = () => {
    const live = new Set<Document>()
    const visit = (current: Window) => {
      try {
        const doc = current.document
        if (live.has(doc)) return
        live.add(doc)
        if (!attached.has(doc)) {
          const detach = attach(current)
          const observer = new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsFrame))) schedule()
          })
          observer.observe(doc, { childList: true, subtree: true })
          const loaded = (event: Event) => { if ((event.target as Element)?.localName === 'iframe') schedule() }
          doc.addEventListener('load', loaded, true)
          attached.set(doc, () => { observer.disconnect(); doc.removeEventListener('load', loaded, true); detach() })
        }
        doc.querySelectorAll('iframe').forEach(frame => { if (frame.contentWindow) visit(frame.contentWindow) })
      } catch { /* Cross-origin frames use the explicit message bridge. */ }
    }
    visit(root)
    for (const [doc, detach] of attached) {
      if (!live.has(doc)) { detach(); attached.delete(doc) }
    }
  }
  scan()
  return () => {
    stopped = true
    attached.forEach(detach => detach())
    attached.clear()
  }
}
