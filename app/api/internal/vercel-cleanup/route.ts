import { timingSafeEqual } from 'node:crypto'
import { vercelRequest } from '../../../../scripts/prune-vercel-deployments.mjs'
import { pruneTeamDeployments } from '../../../../scripts/prune-vercel-team.mjs'

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
    // One credential stays in Vercel and manages only the configured team.
    // Callers cannot supply another team, project, or API operation.
    const result = await pruneTeamDeployments({
      request: vercelRequest(process.env.VERCEL_CLEANUP_TOKEN),
      apply: !dryRun,
      log: () => {},
    })
    return Response.json(result, { status: result.errors.length ? 503 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'La limpieza se detuvo. Revisar la credencial de Vercel y el despliegue activo.' }, { status: 503 })
  }
}
