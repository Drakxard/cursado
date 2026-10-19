import { cooperationState, decideCooperationDeletion, notifyCooperationDeletion, startCooperationBackground } from './cooperation.ts'
import { mergeCooperation } from '../cooperation-model.ts'

// PDF.js is a standalone page; use the same durable local mirror as Study.
Object.assign(window, { cursadoMergeCooperation: mergeCooperation })
if (!new URLSearchParams(location.search).has('native')) {
  const stop = startCooperationBackground()
  window.addEventListener('pagehide', stop, { once: true })
  let dialog: HTMLDialogElement | null = null
  const showDeletions = () => {
    if (dialog) return
    const pending = cooperationState().deletions.find(d => d.decision === 'wait' && !d.notified)
    if (!pending) return
    void notifyCooperationDeletion(pending.id)
    dialog = document.createElement('dialog')
    dialog.style.cssText = 'max-width:420px;padding:24px;border:1px solid #ccc;border-radius:16px;background:white;color:#111'
    const message = document.createElement('p'); message.textContent = `Se eliminó ${pending.label}. ¿Querés confirmarlo?`
    dialog.append(message)
    for (const [label, decision] of [['Esperar', 'wait'], ['Guardar', 'keep'], ['Confirmar', 'delete']] as const) {
      const button = document.createElement('button'); button.textContent = label; button.style.cssText = 'margin:16px 12px 0 0;padding:8px'
      button.onclick = async () => {
        try { await decideCooperationDeletion(pending.id, decision); dialog?.close(); dialog?.remove(); dialog = null; showDeletions() }
        catch (error) { message.textContent = (error as Error).message }
      }
      dialog.append(button)
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); void decideCooperationDeletion(pending.id, 'wait').then(() => { dialog?.close(); dialog?.remove(); dialog = null }) })
    document.body.append(dialog); dialog.showModal()
  }
  window.addEventListener('cursado-cooperation-changed', showDeletions)
}
