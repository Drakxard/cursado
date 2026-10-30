import { requireAuthSession } from '@/lib/authz'
import { PlantUmlError, renderPlantUml } from '@/lib/server/plantuml'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    if (Number(request.headers.get('content-length') || 0) > 120_000) throw new PlantUmlError('El código supera el límite permitido.', 413)
    const body = await request.text()
    if (new TextEncoder().encode(body).length > 120_000) throw new PlantUmlError('El código supera el límite permitido.', 413)
    let source: unknown
    try { source = JSON.parse(body).source } catch { throw new PlantUmlError('La solicitud no contiene código PlantUML válido.') }
    const png = await renderPlantUml(source, request.signal)
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    return Response.json({ error: error instanceof PlantUmlError ? error.message : 'No se pudo renderizar el diagrama. Intentá nuevamente.' }, { status: error instanceof PlantUmlError ? error.status : 502 })
  }
}
