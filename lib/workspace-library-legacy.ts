import { isLibraryPath } from './workspace-library'

export type LegacyLibraryFile = { key: string; path: string; size: number; mime: string }
export type LegacyLibraryCatalog = { documents: { path: string; data: Record<string, unknown> }[]; files: LegacyLibraryFile[] }
export function isLegacyLibraryKey(key: string) {
  return key.length <= 1000 && !/[\\\x00-\x1f]/.test(key) && !key.split('/').some(part => !part || part === '.' || part === '..' || /^(?:copias|backups|migration|migracion-navegador|sessions|provider|pairings|devices)$/i.test(part)) && !/(?:\.backup\.|\.pre-reconciliation\.)/i.test(key) && (key.startsWith('r2/') || isLibraryPath(key) && !key.startsWith('boards/'))
}
export function legacyLocalPath(key: string, kind = '') {
  if (!key.startsWith('r2/')) return isLibraryPath(key) ? key : null
  const root = /\.(?:mp3|m4a|wav|webm|ogg)$/i.test(key) ? 'audio' : key.startsWith('r2/cronograma/') ? 'cronograma' : kind === 'practice' ? 'practica' : 'teoria'
  const path = `${root}/${key.slice(3)}`
  return isLibraryPath(path) ? path : null
}
