import Groq from "groq-sdk"
import { requireAuthSession } from "@/lib/authz"
import { sealInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  const headers = { "Cache-Control": "no-store" }
  try {
    const body = await request.json()
    if (typeof body.apiKey !== "string" || !body.apiKey.trim() || body.apiKey.length > 4096) return Response.json({ error: "Pegá tu clave de Groq." }, { status: 400, headers })
    const apiKey = body.apiKey.trim()
    await new Groq({ apiKey, timeout: 15000, maxRetries: 0 }).models.list()
    return Response.json({ token: sealInscreenUserConfig({ GROQ_API_KEY: apiKey }) }, { headers })
  } catch {
    return Response.json({ error: "No se pudo validar la clave. Revisala e intentá de nuevo." }, { status: 400, headers })
  }
}
