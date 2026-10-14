const saves = new Map<() => Promise<void> | void, number>()
let leaving = false
export function beforeHome(save: () => Promise<void> | void, priority = 0) {
  saves.set(save, priority)
  return () => { saves.delete(save) }
}
export function installHomeShortcut() {
  window.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'q' || event.repeat) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (leaving) return
    leaving = true
    void (async () => {
      try {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        for (const [save] of [...saves].sort((a, b) => a[1] - b[1])) await save()
        window.location.assign('/')
      } catch (error) {
        window.dispatchEvent(new CustomEvent('cursado-home-error', { detail: error instanceof Error ? error.message : 'No se pudieron guardar los cambios.' }))
      } finally { leaving = false }
    })()
  }, true)
}
