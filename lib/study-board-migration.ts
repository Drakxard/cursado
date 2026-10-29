// This converter deliberately has no dependency on either board engine.
// Originals remain in progreso/pizarras; only the returned objects enter Yjs.
export const STUDY_CONVERTER_VERSION = 1
export type StudyObject = Record<string, any>
export type LegacyStudyBoard = { version: number; boardId: string; name: string; content: Record<string, any>; assets: Record<string, string> }
export type MigrationReport = { version: number; types: string[]; partial: string[]; errors: string[]; count: number }
export function migrationTypeLabel(type: string) {
  return ({ strokes: 'Trazos', texts: 'Texto', images: 'Imágenes', 'pdf-pages': 'Páginas PDF', 'pdf-shortcut': 'Accesos PDF', 'board-shortcut': 'Accesos a pizarras', 'important-countdown': 'Contadores', sticky: 'Notas', shapes: 'Figuras', connectors: 'Conectores', lines: 'Líneas', tables: 'Tablas', videos: 'Videos', 'shapes:review-marker': 'Marcadores de repaso' } as Record<string, string>)[type] || 'Elementos anteriores'
}
export function migrationErrorSummary(errors: string[]) {
  const counts = new Map<string, number>()
  for (const error of errors) counts.set(error, (counts.get(error) || 0) + 1)
  const lines = [...counts].slice(0, 3).map(([error, count]) => `${error}${count > 1 ? ` (${count} elementos)` : ''}`)
  if (counts.size > 3) lines.push(`Y ${counts.size - 3} problemas adicionales.`)
  return lines.join('\n')
}
export type StudyAttachment = { kind: 'pdf' | 'board' | 'important' | 'youtube' | 'table' | 'legacy'; reference?: any; taskId?: string; videoId?: string; start?: number; end?: number; table?: any; original?: any; pinned?: boolean }

export function migrationNeedsReview(report: MigrationReport, approved: Record<string, number>) {
  return report.count > 0 && (report.errors.length > 0 || report.partial.length > 0 || report.types.some(type => approved[type] !== report.version))
}
export function acceptMigrationTypes(approved: Record<string, number>, report: MigrationReport) {
  if (report.errors.length) throw new Error('La migración tiene errores pendientes.')
  const result = { ...approved }
  for (const type of report.types) if (!report.partial.includes(type)) result[type] = report.version
  return result
}

export function studyCard(id: string, label: string, study: StudyAttachment, x = 40, y = 40): StudyObject {
  return { id, type: 'text', x, y, width: 320, height: 62, shape: 'rounded', runs: [{ text: label, color: '#1e40af' }], fontFamily: 'system-ui', fontSize: 18, align: 'left', bg: '#eff6ff', borderColor: '#2563eb', borderStyle: 'solid', authorId: 'estudio', study }
}

export async function convertStudyBoard(snapshot: LegacyStudyBoard, image: (item: any, data: string | undefined) => Promise<string>): Promise<{ objects: StudyObject[]; report: MigrationReport }> {
  const objects: StudyObject[] = [], types = new Set<string>(), partial = new Set<string>(), errors: string[] = []
  const content = snapshot.content
  const entries = ['strokes', 'texts', 'media', 'shapes', 'tables', 'graphs', 'videos'].flatMap(kind => (content[kind] || []).map((item: any, index: number) => ({ kind, item, index })))
  entries.sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
  for (const { kind, item, index } of entries) {
    const id = `legacy:${snapshot.boardId}:${kind}:${item.id ?? index}`
    const base = { id, authorId: 'estudio', x: item.x ?? 0, y: item.y ?? 0, rotation: item.rotation ? item.rotation * 180 / Math.PI : 0, ...(item.groupId ? { groupId: `legacy:${snapshot.boardId}:${item.groupId}` } : {}) }
    let type = kind
    try {
      let object: StudyObject
      if (kind === 'strokes') {
        object = { id, authorId: 'estudio', type: 'stroke', points: item.points.flatMap((p: any) => [p.x, p.y]), color: item.color, width: item.width, style: 'solid', opacity: 1 }
      } else if (kind === 'texts') {
        object = { ...base, type: 'text', runs: [{ text: item.text, color: item.color }], fontFamily: 'system-ui', fontSize: item.fontSize, align: 'left' }
      } else if (kind === 'media' && item.kind !== 'audio') {
        type = item.pdfSource ? 'pdf-pages' : 'images'
        object = { ...base, type: 'image', src: await image(item, snapshot.assets[item.assetId]), width: item.width, height: item.height }
        if (item.crop) { partial.add(type); object.legacyOriginal = item }
      } else if (kind === 'shapes' && ['pdf-shortcut', 'board-shortcut', 'important-countdown'].includes(item.visualType)) {
        type = item.visualType
        const study: StudyAttachment = item.visualType === 'pdf-shortcut' ? { kind: 'pdf', reference: item.pdfReference, pinned: !!item.pdfPinned }
          : item.visualType === 'board-shortcut' ? { kind: 'board', reference: item.boardReference } : { kind: 'important', taskId: item.importantTaskId }
        object = { ...studyCard(id, item.label || (study.kind === 'important' ? 'Importante' : 'Acceso'), study), ...base, width: item.width, height: item.height }
      } else if (kind === 'shapes' && !item.visualType && ['line', 'arrow', 'double-arrow'].includes(item.kind)) {
        type = 'lines'
        const from = { x: item.x, y: item.y + (item.reverse ? item.height : 0) }, to = { x: item.x + item.width, y: item.y + (item.reverse ? 0 : item.height) }
        object = { id, authorId: 'estudio', type: 'connector', kind: item.kind === 'line' ? 'line' : 'arrow', from: item.backwards ? to : from, to: item.backwards ? from : to, color: item.color, width: item.strokeWidth, style: item.strokeStyle === 'solid' || !item.strokeStyle ? 'solid' : 'dashed', startCap: item.kind === 'double-arrow' ? 'arrow' : 'none', endCap: item.kind === 'line' ? 'none' : 'arrow', label: item.label || '' }
        if (item.rotation || item.strokeStyle === 'dot') partial.add(type)
      } else if (kind === 'shapes' && item.visualType === 'connector') {
        type = 'connectors'
        const c = item.connector
        object = { id, authorId: 'estudio', type: 'connector', kind: c.route === 'elbow' ? 'elbow' : 'line', from: c.start, to: c.end, color: item.color, width: item.strokeWidth, style: c.style === 'solid' ? 'solid' : 'dashed', startCap: c.startCap, endCap: c.endCap, label: c.label }
        // Endpoint coordinates survive; bindings/curves do not have identical semantics.
        if (c.from || c.to || c.route === 'curve') partial.add(type)
      } else if (kind === 'shapes' && (!item.visualType || item.visualType === 'sticky')) {
        type = item.visualType === 'sticky' ? 'sticky' : 'shapes'
        const shape = item.kind === 'triangle-down' ? 'triangleDown' : item.kind === 'circle' ? 'ellipse' : item.kind
        object = { ...base, type: 'text', width: item.width, height: item.height, shape, runs: [{ text: item.note?.text ?? item.label ?? '', color: item.labelColor ?? item.color, bold: !!item.labelBold, italic: !!item.labelItalic, strike: !!item.labelStrike, ...(item.labelHref ? { link: item.labelHref } : {}) }], fontFamily: item.labelFontFamily || 'system-ui', fontSize: item.note?.fontSize || item.labelFontSize || 18, align: item.labelAlign || 'center', bg: item.note?.background || item.fill || '#ffffff00', borderColor: item.color, borderStyle: item.strokeWidth === 0 ? 'none' : item.strokeStyle === 'dash' ? 'dashed' : 'solid' }
        if (item.fillOpacity !== undefined && item.fillOpacity !== 1 || item.strokeStyle === 'dot' || item.note?.study || item.labelList) partial.add(type)
      } else if (kind === 'tables') {
        object = { ...studyCard(id, item.name || 'Tabla', { kind: 'table', table: item }), ...base, width: 38 + (item.cells[0]?.length || 1) * item.cellWidth, height: 59 + item.cells.length * item.cellHeight }
      } else if (kind === 'videos') {
        object = { ...studyCard(id, 'YouTube', { kind: 'youtube', videoId: item.videoId, start: item.start ?? 0, ...(item.end !== undefined ? { end: item.end } : {}) }), ...base, width: item.width, height: item.height }
      } else {
        type = `${kind}:${item.visualType || item.kind || 'other'}`
        partial.add(type)
        object = { ...studyCard(id, item.label || item.name || `Elemento anterior: ${type}`, { kind: 'legacy', original: item }), ...base }
      }
      // Preserve all original properties even when the new engine has no editable equivalent.
      if (base.groupId) object.groupId = base.groupId
      object.legacyOriginal = item
      objects.push(object); types.add(type)
    } catch (error) { errors.push(`${migrationTypeLabel(type)}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return { objects, report: { version: STUDY_CONVERTER_VERSION, types: [...types], partial: [...partial], errors, count: entries.length } }
}
