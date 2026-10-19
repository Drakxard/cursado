export async function uploadCooperationFile(sphereId: string, hash: string, blob: Blob, mime: string, options: { configToken?: string; workspaceId?: string } = {}) {
  if (blob.size > 100 * 1024 * 1024) throw new Error('El archivo supera 100 MB.')
  const session = await fetch('/pizarra/upload-session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(options.configToken ? { 'x-inscreen-config-token': options.configToken } : {}) },
    body: JSON.stringify({ sphereId, hash, size: blob.size, mime, workspaceId: options.workspaceId, supportsReuse: true }),
  })
  const result = await session.json()
  if (!session.ok) throw new Error(result.error || result.detail || 'No se pudo autorizar la subida cooperativa.')
  if (result.exists) return
  if (typeof result.uploadUrl !== 'string' || !result.uploadUrl) throw new Error('No se recibió una URL de subida. Cerrá las otras pestañas de Cursado y recargá esta pestaña.')
  const response = await fetch(result.uploadUrl, { method: 'PUT', headers: result.headers, body: blob, credentials: 'omit' })
  if (!response.ok) throw new Error(`No se pudo subir el archivo cooperativo a R2 (${response.status}).`)
}
