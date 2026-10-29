import { uploadImage } from './uploads'
import { studyCard, type StudyObject } from '../../../../lib/study-board-migration'
import { svgToPng } from '../../../../lib/study-svg-import'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Same PDF.js render settings, cleanup, CSV limits and Excel service as the current board.
async function openPdf(blob: Blob) {
  const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
  try { return { task, pdf: await task.promise } } catch (error) { await task.destroy(); throw error }
}
async function pageBlob(pdf: Awaited<ReturnType<typeof openPdf>>['pdf'], number: number) {
  const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(1.5, 1800 / Math.max(base.width, base.height)) })
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
  try {
    const context = canvas.getContext('2d'); if (!context) throw new Error('No se pudo preparar la página PDF.')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo convertir la página.')), 'image/png'))
    return { blob, width: base.width, height: base.height }
  } finally { canvas.width = canvas.height = 0; page.cleanup() }
}
export async function renderPdfPage(blob: Blob, number: number) {
  const { pdf, task } = await openPdf(blob)
  try { return (await pageBlob(pdf, number)).blob } finally { await task.destroy() }
}
export function parseStudyCsv(raw: string) {
  const delimiter = (raw.split(/\r?\n/, 1)[0]!.match(/;/g) || []).length > (raw.split(/\r?\n/, 1)[0]!.match(/,/g) || []).length ? ';' : ','
  const rows: { input: string }[][] = []; let row: { input: string }[] = [], value = '', quoted = false
  for (let i = 0; i < raw.length && rows.length < 180; i++) {
    const ch = raw[i]
    if (ch === '"' && quoted && raw[i + 1] === '"') { value += '"'; i++ }
    else if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === delimiter || ch === '\n' || ch === '\r')) {
      if (ch === '\r' && raw[i + 1] === '\n') i++
      row.push({ input: value }); value = ''
      if (ch !== delimiter) { rows.push(row.slice(0, 32)); row = [] }
    } else value += ch
  }
  if ((value || row.length) && rows.length < 180) { row.push({ input: value }); rows.push(row.slice(0, 32)) }
  return rows
}
export async function* importStudyFiles(files: File[], point: { x: number; y: number }, status: (value: string) => void): AsyncGenerator<StudyObject> {
  const upload = (file: File) => uploadImage(file, { reuseExisting: true, onWait: ms => status(ms ? `Pausa automática de ${Math.ceil(ms / 1000)} s; la subida continuará sola.` : `Subiendo ${file.name}…`) })
  let y = point.y
  for (const file of files) {
    status(`Importando ${file.name}…`)
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const { task, pdf } = await openPdf(file)
      try {
        for (let number = 1; number <= pdf.numPages; number++) {
          status(`Importando PDF: página ${number} de ${pdf.numPages}`)
          const page = await pageBlob(pdf, number), uploaded = await upload(new File([page.blob], `${file.name}-${number}.png`, { type: 'image/png' }))
          yield { id: crypto.randomUUID(), type: 'image', authorId: 'estudio', src: uploaded.key, x: point.x, y, width: page.width, height: page.height }; y += page.height + 30
        }
      } finally { await task.destroy() }
    } else if (/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
      let sheets: { name: string; cells: any[][] }[]
      if (/\.csv$/i.test(file.name)) sheets = [{ name: file.name.replace(/\.csv$/i, ''), cells: parseStudyCsv(await file.text()) }]
      else {
        if (file.size > 12 * 1024 * 1024) throw new Error('El Excel supera 12 MB.')
        const response = await fetch('/pizarra/api/excel/import', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: await file.arrayBuffer() })
        const result = await response.json(); if (!response.ok) throw new Error(result.detail || `Error ${response.status}`)
        sheets = result.sheets; if (!sheets?.length) throw new Error('No se encontraron hojas.')
      }
      for (const sheet of sheets) {
        const columns = Math.max(1, ...sheet.cells.map(row => row.length))
        sheet.cells = sheet.cells.map(row => Array.from({ length: columns }, (_, index) => row[index] || { input: '' }))
        if (!sheet.cells.length) sheet.cells = [[{ input: '' }]]
        const table = { ...sheet, cellWidth: 114, cellHeight: 33 }, object = studyCard(crypto.randomUUID(), sheet.name, { kind: 'table', table }, point.x, y)
        object.width = 38 + Math.max(1, ...sheet.cells.map(row => row.length)) * 114; object.height = 59 + sheet.cells.length * 33
        yield object; y += object.height + 64
      }
    } else if (file.type.startsWith('image/') || /\.(svg|png|jpe?g|webp|gif)$/i.test(file.name)) {
      const blob = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml' ? await svgToPng(file) : file
      const type = blob.type || (/\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/png')
      const uploaded = await upload(new File([blob], file.name, { type }))
      yield { id: crypto.randomUUID(), type: 'image', authorId: 'estudio', src: uploaded.key, x: point.x, y, width: uploaded.width, height: uploaded.height }; y += uploaded.height + 30
    } else throw new Error(`Formato no admitido: ${file.name}`)
  }
}
