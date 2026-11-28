// Highlight ranges never change the editable DOM or the stored rich-text runs.
type Mark = { range: Range; word: string }
type Highlights = Map<string, unknown>
const highlights = () => (CSS as unknown as { highlights?: Highlights }).highlights
const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight

export function installSpelling(editor: HTMLElement): () => void {
  editor.lang = 'es-AR'
  editor.spellcheck = !HighlightClass || !highlights() // Native fallback on browsers without custom highlights.
  if (!HighlightClass || !highlights()) return () => {}
  const worker = new Worker(new URL('./spelling-worker.ts', import.meta.url), { type: 'module' })
  const lifetime = new AbortController(), signal = lifetime.signal
  const pending = new Map<number, { resolve: (value: string[]) => void; reject: () => void }>()
  let serial = 0, revision = 0, timer = 0, composing = false, disposed = false
  let marks: Mark[] = [], popup: HTMLDivElement | undefined
  const close = () => { popup?.remove(); popup = undefined }
  const request = (data: Record<string, unknown>) => new Promise<string[]>((resolve, reject) => {
    const id = ++serial
    pending.set(id, { resolve, reject })
    worker.postMessage({ ...data, id })
  })
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id)
    pending.delete(data.id)
    if (data.error) job?.reject(); else job?.resolve(data.value)
  }
  worker.onerror = () => {
    editor.spellcheck = true
    for (const job of pending.values()) job.reject()
    pending.clear()
  }
  const scan = async () => {
    const version = revision, candidates: Mark[] = []
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (node.parentElement?.closest('a,[contenteditable="false"],code,pre')) continue
      for (const match of node.data.matchAll(/[\p{L}\p{M}]+/gu)) {
        const word = match[0]
        // Skip initials, long identifiers and fragments of URLs or variable names.
        if (word.length < 2 || word.length > 40 || /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(word) ||
          /[\d_/@.:]/.test(node.data[match.index! - 1] || '') || /[\d_/@]/.test(node.data[match.index! + word.length] || '')) continue
        const range = document.createRange()
        range.setStart(node, match.index!); range.setEnd(node, match.index! + word.length)
        candidates.push({ range, word })
      }
    }
    try {
      const errors = new Set(await request({ type: 'check', words: candidates.map(mark => mark.word) }))
      if (disposed || version !== revision || composing) return
      marks = candidates.filter(mark => errors.has(mark.word))
      highlights()!.set('study-spelling', new HighlightClass!(...marks.map(mark => mark.range)))
    } catch { if (!disposed) editor.spellcheck = true }
  }
  const schedule = () => {
    revision++; close(); marks = []; highlights()!.delete('study-spelling')
    clearTimeout(timer)
    if (!composing) timer = window.setTimeout(scan, 450)
  }
  editor.addEventListener('input', schedule, { signal })
  editor.addEventListener('compositionstart', () => { composing = true; schedule() }, { signal })
  editor.addEventListener('compositionend', () => { composing = false; schedule() }, { signal })
  editor.addEventListener('click', async event => {
    if (composing) return
    const mark = marks.find(({ range }) => Array.from(range.getClientRects()).some(rect =>
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom))
    if (!mark) { close(); return }
    const version = revision
    close()
    const box = document.createElement('div')
    popup = box; box.className = 'study-spelling-menu'; box.setAttribute('role', 'group')
    box.setAttribute('aria-label', `Correcciones para ${mark.word}`)
    const label = document.createElement('span'); label.textContent = 'Buscando correcciones…'; box.append(label)
    document.body.append(box)
    const rect = mark.range.getBoundingClientRect()
    box.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 270))}px`
    box.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - 220))}px`
    // Keep the selection and editing session alive while choosing a correction.
    box.addEventListener('pointerdown', e => e.preventDefault(), { signal })
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); editor.focus() } }, { signal })
    try {
      const suggestions = await request({ type: 'suggest', word: mark.word })
      if (disposed || version !== revision || popup !== box) return
      box.replaceChildren()
      const title = document.createElement('span'); title.textContent = `Corregir «${mark.word}»`; box.append(title)
      for (const word of suggestions) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = word
        button.addEventListener('click', () => {
          if (version !== revision || mark.range.toString() !== mark.word) return close()
          editor.focus()
          const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(mark.range)
          // Browser editing preserves surrounding marks, undo, and the normal input broadcast.
          document.execCommand('insertText', false, word)
          schedule()
        }, { signal })
        box.append(button)
      }
      if (!suggestions.length) { const empty = document.createElement('span'); empty.textContent = 'Sin sugerencias'; box.append(empty) }
      const ignore = document.createElement('button'); ignore.type = 'button'; ignore.textContent = 'Cerrar'
      ignore.addEventListener('click', () => { close(); editor.focus() }, { signal }); box.append(ignore)
    } catch { if (popup === box) label.textContent = 'No se pudieron cargar las sugerencias' }
  }, { signal })
  document.addEventListener('pointerdown', event => {
    if (!editor.contains(event.target as Node) && !popup?.contains(event.target as Node)) close()
  }, { signal })
  editor.addEventListener('keydown', event => { if (event.key === 'Escape') close() }, { signal })
  schedule()
  return () => {
    disposed = true; clearTimeout(timer); lifetime.abort(); close(); worker.terminate()
    for (const job of pending.values()) job.reject()
    pending.clear(); highlights()!.delete('study-spelling')
  }
}
