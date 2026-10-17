import { requireAuthSession } from "@/lib/authz"
import { sealInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  const headers = { "Cache-Control": "no-store" }
  try {
    const body = await request.json()
    if (typeof body.apiKey !== "string" || !body.apiKey.trim() || body.apiKey.length > 4096) return Response.json({ error: "Pegá tu clave de Datalab." }, { status: 400, headers })
    return Response.json({ token: sealInscreenUserConfig({ datalab: body.apiKey.trim() }) }, { headers })
  } catch {
    return Response.json({ error: "No se pudo guardar la clave de Datalab." }, { status: 400, headers })
  }
}
