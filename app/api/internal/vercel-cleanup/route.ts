import { timingSafeEqual } from 'node:crypto'
import { pruneDeployments, vercelRequest } from '../../../../scripts/prune-vercel-deployments.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.VERCEL_CLEANUP_TRIGGER_SECRET
  const supplied = request.headers.get('authorization') || ''
  const expected = secret ? `Bearer ${secret}` : ''
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
  let dryRun = false
  try { dryRun = (await request.json()).dryRun === true }
  catch { return Response.json({ error: 'Solicitud inválida' }, { status: 400 }) }
  try {
    // The Vercel API credential stays in Vercel. Only this fixed project's
    // cleanup operation is exposed to the authenticated GitHub trigger.
    const result = await pruneDeployments({
      request: vercelRequest(process.env.VERCEL_CLEANUP_TOKEN),
      apply: !dryRun,
      log: () => {},
    })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'La limpieza se detuvo. Revisar la credencial de Vercel y el despliegue activo.' }, { status: 503 })
  }
}
