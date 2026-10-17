import { getInscreenR2Config, normalizeInscreenUserConfig, readInscreenUserConfig, type InscreenR2Config } from '@/lib/inscreen-user-config'
import { servicesStatus } from '@/lib/services-config'

/** Resolve the same personal R2 used by publishing, without returning secrets. */
export function workspaceLibraryConfig(request: Request): { r2: InscreenR2Config; source: 'workspace' | 'deployment' | 'none' } {
  if (request.headers.get('x-inscreen-config-token')) {
    // An unreadable personal file needs recovery; never treat it as absent.
    const config = readInscreenUserConfig(request)
    if (servicesStatus(config).r2) return { r2: getInscreenR2Config(config), source: 'workspace' }
  }
  const fields = ['R2_BUCKET_NAME', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const
  const supplied = Object.fromEntries(fields.map(field => [field, (process.env[field] || '').trim()]))
  if (fields.every(field => supplied[field])) {
    const config = normalizeInscreenUserConfig(supplied)
    return { r2: getInscreenR2Config(config), source: 'deployment' }
  }
  return { r2: { R2_BUCKET_NAME: '', R2_ENDPOINT: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' }, source: 'none' }
}
