'use client'
import { getReadyInscreenConfigToken, loadInscreenFileHalf, loadServicesFile, persistServicesFile, setReadyInscreenConfigToken } from '@/lib/local-workspace-client'

export async function libraryConnection(root?: FileSystemDirectoryHandle | null): Promise<{ configured: boolean; source: 'workspace' | 'deployment' | 'none' }> {
  if (root) {
    let services = await loadServicesFile(root)
    if (!services?.inscreenToken) {
      const legacy = await loadInscreenFileHalf(root)
      if (legacy) {
        const response = await fetch('/api/inscreen/config/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileHalf: legacy }) })
        const result = await response.json()
        if (!response.ok || !result.token) throw new Error(result.error || 'No se pudo abrir la configuración anterior. Elegí la carpeta donde configuraste R2.')
        services = await persistServicesFile(root, { inscreenToken: result.token, driveToken: services?.driveToken || '', seedFingerprint: result.seedFingerprint || '', validatedAt: new Date().toISOString() })
      }
    }
    setReadyInscreenConfigToken(services?.inscreenToken || '')
  }
  const token = getReadyInscreenConfigToken()
  const response = await fetch('/api/inscreen/workspace/config', { cache: 'no-store', headers: token ? { 'x-inscreen-config-token': token } : {} })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo comprobar tu conexión con R2.')
  return result
}
