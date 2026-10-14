import { withOptionalServicesConfig } from '@/lib/inscreen-user-config'
import { requireAuthSession } from "@/lib/authz"
import { CLEF_FLASH_MODEL, getClefConfiguration } from "@/lib/server/cloudflare-clef"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handleGET() {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  const { configured, missing } = getClefConfiguration()
  return Response.json(
    { model: CLEF_FLASH_MODEL, configured, ...(!configured ? { missing } : {}) },
    { status: configured ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  )
}

export async function GET(request: Request) {
  return withOptionalServicesConfig(request, () => handleGET())
}
