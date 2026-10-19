import { createCooperationR2UploadSession } from '@/lib/cooperation-upload-session'
import { withOptionalServicesConfig } from '@/lib/inscreen-user-config'

export const runtime = 'nodejs'

async function handlePOST(request: Request) {
  const origin = new URL(request.url).origin
  if (request.headers.get('origin') !== origin) return Response.json({ error: 'Origen no permitido.' }, { status: 403 })
  if (Number(request.headers.get('content-length') || 0) > 4096) return Response.json({ error: 'Solicitud demasiado grande.' }, { status: 413 })
  try {
    const text = await request.text()
    if (text.length > 4096) return Response.json({ error: 'Solicitud demasiado grande.' }, { status: 413 })
    const { sphereId, hash, size, mime, workspaceId, supportsReuse } = JSON.parse(text)
    if (!/^[a-f0-9-]{36}$/.test(sphereId || '') || !/^[a-f0-9]{64}$/.test(hash || '') || !Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024 || typeof mime !== 'string' || mime.length > 200) {
      return Response.json({ error: 'Archivo inválido.' }, { status: 422 })
    }
    const backend = process.env.PIZARRA_BACKEND_URL
    if (!backend) throw new Error('Falta configurar PIZARRA_BACKEND_URL.')
    // Membership is checked by the service that owns the Pizarra session.
    const authorization = await fetch(new URL(`/api/cooperation/spheres/${sphereId}/files/${hash}`, backend), {
      method: 'POST', headers: { Cookie: request.headers.get('cookie') || '', Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size }), cache: 'no-store', redirect: 'error',
    })
    const result = await authorization.json()
    if (!authorization.ok) return Response.json(result, { status: authorization.status })
    if (result.exists) {
      // Older tabs always call fetch(uploadUrl), even when no upload is needed.
      if (!supportsReuse && !request.headers.get('x-inscreen-config-token')) return Response.json({ error: 'Esta pestaña usa una versión anterior de Cooperativo. Cerrá las otras pestañas de Cursado y recargá con Ctrl+Shift+R.' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
      return Response.json({ exists: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    return Response.json(await createCooperationR2UploadSession({ objectKey: result.objectKey, bucket: result.bucket, hash, size, mime, workspaceId }), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Cooperation upload session failed:', error)
    return Response.json({ error: 'No se pudo preparar la subida a R2. Revisá la configuración R2 de User.Services o del servidor.' }, { status: 503 })
  }
}

export function POST(request: Request) {
  return withOptionalServicesConfig(request, () => handlePOST(request))
}
