import * as Y from 'yjs'
import { addObject, objectsMap, type BoardObject } from '@komuboard/shared'
import type YProvider from 'y-partyserver/provider'
import type { BoardCanvas } from './canvas'
import { uploadImage, UploadError } from './uploads'
import { convertStudyBoard, repairStudyReviewMarker, migrationErrorSummary, studyCard, STUDY_CONVERTER_VERSION, type StudyObject, type StudyAttachment, type MigrationReport } from '../../../../lib/study-board-migration'
import { BOARD_PDF_MIME, BOARD_LINK_MIME, BOARD_IMPORTANT_MIME, BOARD_SHORTCUT_MIME, parseBoardShortcutDrag, parseBoardPdfDrag, parseBoardLinkDrag, parseImportantDrag } from '../../../../lib/board-library-contract'
import './study.css'
import { disposeStudy } from './study-render'

function encode(bytes: Uint8Array) {
  let value = ''; for (let at = 0; at < bytes.length; at += 8192) value += String.fromCharCode(...bytes.subarray(at, at + 8192)); return btoa(value)
}
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }

export function installStudyBridge(doc: Y.Doc, provider: YProvider, canvas: BoardCanvas) {
  const params = new URLSearchParams(location.search), session = params.get('session'), boardId = params.get('topicBoard')
  const observer = new MutationObserver(records => {
    // text-layer moves nodes to maintain z-order; only unmount truly removed players.
    for (const record of records) for (const node of record.removedNodes) if (node instanceof HTMLElement && !node.isConnected) {
      if (node.matches('[data-study="youtube"]')) disposeStudy(node)
      node.querySelectorAll<HTMLElement>('[data-study="youtube"]').forEach(disposeStudy)
    }
  })
  observer.observe(document.getElementById('board')!, { childList: true, subtree: true })
  document.addEventListener('study-video', ((event: CustomEvent) => {
    const data = event.detail, map = objectsMap(doc).get(data.id), study = map?.get('study') as any
    if (study?.kind !== 'youtube') return
    if (data.action) {
      const signal = { video_id: study.videoId, position: data.position, playing: data.action === 'play' || (['seek', 'position'].includes(data.action) && !!study.signal?.playing), start: study.start || 0, end: study.end ?? null, at: Date.now() / 1000, serial: Date.now() }
      map!.set('study', { ...study, signal })
    } else map!.set('study', { ...study, start: data.start, end: data.end })
  }) as EventListener)
  if (!session || !boardId || window.parent === window) {
    document.addEventListener('click', event => {
      if ((event.target as Element)?.closest('[data-study-action]')) alert('Abrí esta pizarra desde Estudio para acceder a sus materiales y tareas locales.')
    })
    return
  }
  document.body.classList.add('study-embedded')
  let initialized = false, busy = false, report: MigrationReport | undefined, checkpointTimer: ReturnType<typeof setTimeout> | undefined
  const send = (type: string, data: Record<string, unknown> = {}) => parent.postMessage({ type: `study-board:${type}`, session, boardId, ...data }, location.origin)
  const checkpoint = () => { send('checkpoint', { draft: encode(Y.encodeStateAsUpdate(doc)), report, imported: !!doc.getMap('study-migration').get('complete') }); checkpointTimer = undefined }
  const atCenter = () => { const view = canvas.worldViewport(); return { x: view.x + view.width / 2, y: view.y + view.height / 2 } }
  const insert = (object: StudyObject) => {
    if (objectsMap(doc).has(object.id)) return
    addObject(doc, object as BoardObject)
    const map = objectsMap(doc).get(object.id)!
    if (object.study) map.set('study', object.study)
    if (object.legacyOriginal) map.set('legacyOriginal', object.legacyOriginal)
  }
  let pinnedPdfId: string | undefined
  const emitPins = () => {
    const pins = [...objectsMap(doc).values()].flatMap(map => {
    const study = map.get('study') as any
    return study?.kind === 'pdf' && study.pinned ? [{ id: map.get('id'), reference: study.reference }] : []
    })
    const pin = pins.at(-1)
    pinnedPdfId = typeof pin?.id === 'string' ? pin.id : undefined
    pinButton.disabled = !pin
    pinButton.title = pin ? `${pin.reference.fileName} · Clic para abrir; mantener presionado para ir al acceso · <` : 'Fijá un PDF desde su acceso'
    send('pins', { pins })
    send('pdfs',{pdfs:[...objectsMap(doc).values()].flatMap(map=>{
      const study = map.get('study') as any
      return study?.kind === 'pdf' ? [{id:map.get('id'),reference:study.reference}] : []
    })})
  }
  const uploaded = new Map<string, Promise<string>>()
  let imageIndex = 0, imageCount = 0, uploadFailure: UploadError | null = null
  async function uploadLegacy(item: any, data?: string) {
    if (!data) throw new Error(`Falta el archivo ${item.name || item.assetId}`)
    if (uploadFailure) throw uploadFailure
    const current = ++imageIndex
    const progress = `Migrando imagen ${current} de ${imageCount}…`
    send('status', { status: progress })
    const key = `${item.assetId}:${item.pdfSource ? item.pageNumber : ''}`
    if (!uploaded.has(key)) uploaded.set(key, (async () => {
      let blob = await (await fetch(data)).blob()
      if (item.pdfSource) {
        const { renderPdfPage } = await import('./study-imports'); blob = await renderPdfPage(blob, item.pageNumber || 1)
      }
      return (await uploadImage(new File([blob], 'migracion.png', { type: blob.type }), {
        reuseExisting: true,
        onWait: ms => send('status', { status: ms ? `${progress} Pausa automática de ${Math.ceil(ms / 1000)} s; la subida continuará sola.` : progress }),
      })).key
    })().catch(error => { uploaded.delete(key); if (error instanceof UploadError && error.retryable) uploadFailure = error; throw error }))
    return uploaded.get(key)!
  }
  async function initialize(data: any) {
    if (initialized || busy) return
    busy = true
    try {
      if (typeof data.name === 'string' && !doc.getMap('metadata').get('studyName')) doc.getMap('metadata').set('studyName', data.name)
      if (data.draft) Y.applyUpdate(doc, decode(data.draft))
      const marker = doc.getMap<any>('study-migration')
      const previous = marker.get('report') as MigrationReport | undefined
      if (!marker.get('complete') && data.snapshot) {
        imageIndex = 0; imageCount = (data.snapshot.content.media || []).filter((item: any) => item.kind !== 'audio').length; uploadFailure = null
        const converted = await convertStudyBoard(data.snapshot, uploadLegacy)
        // Deterministic source ids plus a deterministic Yjs client make parallel initial imports
        // the SAME CRDT update, including order entries; user edits keep their own client ids.
        report = converted.report
        if (report.errors.length) { send('migration-errors', { report }); throw new Error(migrationErrorSummary(report.errors)) }
        const seed = new Y.Doc(); seed.clientID = 2147483001
        const updates: Uint8Array[] = []
        seed.on('update', (update: Uint8Array) => updates.push(update))
        for (const object of converted.objects) {
          addObject(seed, object as BoardObject)
          const map = objectsMap(seed).get(object.id)!
          if (object.study) map.set('study', object.study)
          map.set('legacyOriginal', object.legacyOriginal)
        }
        seed.getMap('study-migration').set('report', report)
        seed.getMap('study-migration').set('complete', true)
        if (updates.some(update => update.byteLength > 480 * 1024)) { seed.destroy(); throw new Error('Un elemento supera el límite de sincronización. El original se conservó; dividí ese elemento antes de migrarlo.') }
        // The existing worker caps individual WS messages at 512 KiB. Seed in bounded,
        // deterministic updates, including a completion marker only in the final batch.
        let batch: Uint8Array[] = [], size = 0
        for (const update of updates) {
          if (size + update.byteLength > 192 * 1024 && batch.length) {
            Y.applyUpdate(doc, Y.mergeUpdates(batch), 'study-migration'); batch = []; size = 0
            await new Promise(resolve => setTimeout(resolve, 50))
          }
          batch.push(update); size += update.byteLength
        }
        if (batch.length) Y.applyUpdate(doc, Y.mergeUpdates(batch), 'study-migration')
        seed.destroy()
        if (data.snapshot.content.camera) canvas.restoreStudyView(data.snapshot.content.camera)
      } else report = previous ?? data.report
      if (!data.shared && !data.snapshot && !marker.get('complete')) {
        report = { version: STUDY_CONVERTER_VERSION, types: [], partial: [], errors: [], count: 0 }
        doc.transact(() => { marker.set('report', report!); marker.set('complete', true) }, 'study-migration')
      }
      // Repair v1 placeholders in place, including already accepted/checkpointed boards.
      doc.transact(() => {
        for (const map of objectsMap(doc).values()) {
          const repaired = repairStudyReviewMarker(map.toJSON())
          if (repaired) for (const [key, value] of Object.entries(repaired)) map.set(key, value)
        }
        if (report?.partial.includes('shapes:review-marker')) {
          report = { ...report, version: STUDY_CONVERTER_VERSION, partial: report.partial.filter(type => type !== 'shapes:review-marker') }
          marker.set('report', report)
        }
      }, 'study-migration-repair')
      // New PDFs in a container are appended once, without reopening any reader.
      doc.transact(() => {
        for (const reference of data.pdfReferences || []) {
          const id = `pdf:${boardId}:${reference.materialId}`
          const exists = [...objectsMap(doc).values()].some(map => (map.get('study') as any)?.kind === 'pdf' && (map.get('study') as any).reference?.materialId === reference.materialId)
          if (!exists && !doc.getMap('study-pdf-seeded').has(id)) {
            const view = atCenter(); insert(studyCard(id, reference.fileName, { kind: 'pdf', reference }, view.x - 160, view.y + doc.getMap('study-pdf-seeded').size * 76)); doc.getMap('study-pdf-seeded').set(id, true)
          }
        }
      }, 'study-migration')
      initialized = true; send('ready', { report, converterVersion: STUDY_CONVERTER_VERSION }); checkpoint(); emitPins()
    } catch (error) { send('error', { error: String(error) }) }
    finally { busy = false; send('status', { status: '' }) }
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.session !== session || event.data?.boardId !== boardId) return
    const data = event.data
    if(data.type === 'study-board:pdf-published') {
      const map = objectsMap(doc).get(data.id), study = map?.get('study') as any
      if(study?.kind === 'pdf' && study.reference.materialId === data.reference?.materialId && study.reference.workspaceFileId === data.reference?.workspaceFileId) map!.set('study',{...study,reference:{...study.reference,sharedPdf:data.sharedPdf}})
    }
    if (data.type === 'study-board:init') {
      if (provider.synced) void initialize(data)
      else { const sync = (synced: boolean) => { if (synced) { provider.off('sync', sync); void initialize(data) } }; provider.on('sync', sync) }
    }
    if (data.type === 'study-board:close') {
      if (busy) { send('error', { error: 'Esperá a que termine la importación antes de salir.' }); return }
      checkpoint(); send('closed')
    }
    if (data.type === 'study-board:pin') {
      const map = objectsMap(doc).get(data.id), study = map?.get('study') as any
      if (study?.kind === 'pdf') doc.transact(() => {
        for (const node of objectsMap(doc).values()) { const old = node.get('study') as any; if (old?.kind === 'pdf' && old.pinned) node.set('study', { ...old, pinned: false }) }
        map!.set('study', { ...study, pinned: !study.pinned })
      })
    }
    if (data.type === 'study-board:insert' && initialized) {
      const at = atCenter(); const value = data.object
      if (value && typeof value === 'object') doc.transact(() => insert({ ...value, id: crypto.randomUUID(), x: value.x ?? at.x, y: value.y ?? at.y }))
    }
    if (data.type === 'study-board:update-table') {
      const map = objectsMap(doc).get(data.id), study = map?.get('study') as any
      if (study?.kind === 'table') map!.set('study', { ...study, table: data.table })
    }
    if (data.type === 'study-board:countdowns') {
      document.querySelectorAll<HTMLElement>('[data-study="important"]').forEach(element => {
        const map = objectsMap(doc).get(element.dataset.id!), study = map?.get('study') as any, task = data.tasks?.[study?.taskId]
        const label = element.querySelector<HTMLElement>('.study-card-label')
        if (label) { label.textContent = task ? `${task.days}d` : 'Vínculo no disponible'; element.style.background = task?.color || '#cbd5e1' }
      })
    }
    if (data.type === 'study-board:import-files' && (!initialized || busy)) { send('error', { error: 'Esperá a que termine la carga o importación en curso.' }); return }
    if (data.type === 'study-board:import-files' && initialized && !busy) {
      busy = true
      void import('./study-imports').then(async ({ importStudyFiles }) => {
        for await (const object of importStudyFiles(data.files, atCenter(), status => send('status', { status }))) doc.transact(() => insert(object))
      }).catch(error => send('error', { error: String(error) })).finally(() => { busy = false; send('status', { status: '' }); checkpoint() })
    }
  })
  doc.on('update', () => {
    if (!initialized) return
    if (checkpointTimer) clearTimeout(checkpointTimer)
    checkpointTimer = setTimeout(checkpoint, 500)
    emitPins(); send('changed')
  })
  document.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-study-action]')
    const element = button?.closest<HTMLElement>('[data-id]')
    if (!element) return
    event.stopPropagation()
    const map = objectsMap(doc).get(element.dataset.id!), study = map?.get('study') as StudyAttachment | undefined
    if (study?.kind === 'review') {
      if (study.view && !(event as MouseEvent).shiftKey) canvas.restoreStudyReviewView(study.view)
      else map!.set('study', { ...study, view: canvas.captureStudyReviewView() })
      return
    }
    send(button!.dataset.studyAction === 'pin' ? 'pin' : 'open', { id: element.dataset.id, study })
  }, true)
  // Observe taps without consuming the engine's selection and drag events.
  type CardPress = { id: string; pointer: number; x: number; y: number; held: boolean; timer?: ReturnType<typeof setTimeout> }
  let press: CardPress | undefined
  let lastTap: { id: string; at: number } | undefined
  const card = (id: string) => [...document.querySelectorAll<HTMLElement>('[data-study][data-id]')].find(el => el.dataset.id === id)
  const clearPress = () => {
    if (press?.timer) clearTimeout(press.timer)
    if (press) card(press.id)?.classList.remove('study-holding')
    press = undefined
  }
  document.addEventListener('pointerdown', event => {
    if (press) { clearPress(); lastTap = undefined; return }
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('button,input,[contenteditable],.text-bar')) return
    const id = canvas.studyHitAt(event.clientX, event.clientY)
    const study = id ? objectsMap(doc).get(id)?.get('study') as StudyAttachment : undefined
    if (!id || !study || !['pdf', 'board', 'shortcut'].includes(study.kind)) { lastTap = undefined; return }
    const current = press = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, held: false } as CardPress
    if (study.kind === 'pdf') {
      card(id)?.classList.add('study-holding')
      current.timer = setTimeout(() => {
        if (press !== current) return
        current.held = true; lastTap = undefined
        card(id)?.classList.remove('study-holding')
        send('pin', { id })
      }, 600)
    }
  }, true)
  document.addEventListener('pointermove', event => {
    if (press?.pointer === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) { clearPress(); lastTap = undefined }
  }, true)
  document.addEventListener('pointerup', event => {
    if (!press || press.pointer !== event.pointerId) return
    const current = press; clearPress()
    if (current.held) return
    if (lastTap?.id === current.id && Date.now() - lastTap.at < 450) {
      lastTap = undefined
      const study = objectsMap(doc).get(current.id)?.get('study') as StudyAttachment
      if (study?.kind === 'shortcut') {
        const reference = parseBoardShortcutDrag(JSON.stringify(study.reference))
        if (reference) window.open(reference.url, '_blank', 'noopener,noreferrer')
      } else {
        card(current.id)?.classList.add('study-opening')
        send('open', { id: current.id, study })
      }
    } else lastTap = { id: current.id, at: Date.now() }
  }, true)
  document.addEventListener('pointercancel', () => { clearPress(); lastTap = undefined }, true)
  window.addEventListener('blur', clearPress)
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.session !== session || event.data?.boardId !== boardId) return
    if (event.data.type === 'study-board:open-finished') document.querySelectorAll('.study-opening').forEach(el => el.classList.remove('study-opening'))
  })
  document.addEventListener('keydown', event => {
    if ((event.target as Element)?.closest('input,textarea,select,[contenteditable],[role="textbox"]') || event.repeat || event.isComposing) return
    if (event.key === '<' && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); send('toggle-pdf') }
  }, true)
  const board = document.getElementById('board')!
  board.addEventListener('dragover', event => {
    if ([BOARD_PDF_MIME, BOARD_LINK_MIME, BOARD_IMPORTANT_MIME, BOARD_SHORTCUT_MIME].some(mime => event.dataTransfer?.types.includes(mime)) || event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
  board.addEventListener('drop', event => {
    const transfer = event.dataTransfer; if (!transfer) return
    const pdf = parseBoardPdfDrag(transfer.getData(BOARD_PDF_MIME)), link = parseBoardLinkDrag(transfer.getData(BOARD_LINK_MIME)), important = parseImportantDrag(transfer.getData(BOARD_IMPORTANT_MIME))
    const shortcut = parseBoardShortcutDrag(transfer.getData(BOARD_SHORTCUT_MIME))
    if (!pdf && !link && !important && !shortcut && !transfer.files.length) return
    event.preventDefault(); event.stopImmediatePropagation()
    const rect = board.getBoundingClientRect(), view = canvas.worldViewport(), x = view.x + (event.clientX - rect.left) / rect.width * view.width, y = view.y + (event.clientY - rect.top) / rect.height * view.height
    if (pdf) { send('publish-pdf',{reference:pdf}); doc.transact(() => insert(studyCard(crypto.randomUUID(), pdf.fileName, { kind: 'pdf', reference: pdf }, x, y))) }
    if (link) doc.transact(() => insert(studyCard(crypto.randomUUID(), link.name, { kind: 'board', reference: link }, x, y)))
    if (shortcut) doc.transact(() => insert(studyCard(crypto.randomUUID(), shortcut.name, { kind: 'shortcut', reference: shortcut }, x, y)))
    if (important) doc.transact(() => insert(studyCard(crypto.randomUUID(), 'Importante', { kind: 'important', taskId: important.taskId }, x, y)))
    if (transfer.files.length) send('files', { files: [...transfer.files] })
  }, true)
  const pinButton = document.createElement('button'); pinButton.type = 'button'; pinButton.className = 'tool'; pinButton.disabled = true
  pinButton.setAttribute('aria-label', 'PDF fijado'); pinButton.title = 'Fijá un PDF desde su acceso'
  pinButton.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 2-2 5-2 2-6-6 2-2 5-2Z"/><path d="m10 14-7 7"/></svg>'
  let hold: ReturnType<typeof setTimeout> | undefined, held = false
  const clearHold = () => { if (hold) clearTimeout(hold); hold = undefined }
  pinButton.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    held = false; clearHold(); pinButton.setPointerCapture(event.pointerId)
    hold = setTimeout(() => { held = true; if (pinnedPdfId) canvas.selectById(pinnedPdfId) }, 550)
  })
  pinButton.addEventListener('pointerup', clearHold)
  pinButton.addEventListener('pointercancel', () => { clearHold(); held = true })
  window.addEventListener('blur', clearHold)
  pinButton.onclick = () => { if (!held) send('open-pinned'); held = false }
  const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'tool study-plus'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Agregar a la pizarra'); plus.onclick = () => send('menu')
  document.querySelector('komu-tool-dock')?.append(pinButton, plus)
  send('request-init')
}
