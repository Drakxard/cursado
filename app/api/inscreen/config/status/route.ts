import { getInscreenConfigSeedFingerprint, readInscreenUserConfig } from "@/lib/inscreen-user-config"
import { servicesStatus } from '@/lib/services-config'

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const config = readInscreenUserConfig(request)
    return Response.json({ configured: true, seedFingerprint: getInscreenConfigSeedFingerprint(), services: servicesStatus(config) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    let seedFingerprint = ""
    try { seedFingerprint = getInscreenConfigSeedFingerprint() } catch {}
    return Response.json(
      { configured: false, code: seedFingerprint ? "seed_mismatch_or_corrupt" : "seed_missing", seedFingerprint, error: error instanceof Error ? error.message : "Configuracion InScreen requerida." },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
}
