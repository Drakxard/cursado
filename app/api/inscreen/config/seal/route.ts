import { requireAuthSession } from "@/lib/authz"
import { randomUUID } from "node:crypto"
import { deleteR2Object, downloadR2Object, uploadR2Object } from "@/lib/r2"
import { listGroqGenerationModels } from "@/lib/groq-models"
import { INSCREEN_CONFIG_TOKEN_HEADER, getInscreenConfigSeedFingerprint, normalizeInscreenUserConfig, readInscreenUserConfig, sealInscreenUserConfig, withInscreenRuntimeConfig, type InscreenUserConfig } from "@/lib/inscreen-user-config"
import { servicesStatus } from '@/lib/services-config'
import { workspaceLibraryConfig } from '@/lib/server/workspace-library-config'

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null)
    let previous: Partial<InscreenUserConfig> = {}
    if (request.headers.get(INSCREEN_CONFIG_TOKEN_HEADER)) previous = readInscreenUserConfig(request)
    const updates = body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([, value]) => String(value || "").trim())) : {}
    if (["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"].some(field => field in updates) && !servicesStatus(previous).r2) {
      const existing = workspaceLibraryConfig(request)
      if (existing.source === 'deployment') previous = { ...previous, ...existing.r2 }
    }
    const config = normalizeInscreenUserConfig({ ...previous, ...updates })
    if ("GROQ_API_KEY" in updates) await withInscreenRuntimeConfig(config, () => listGroqGenerationModels())
    if (["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"].some((field) => field in updates)) {
      const objectKey = `manifests/inscreen/health/${randomUUID()}.txt`
      await withInscreenRuntimeConfig(config, async () => {
        try {
          await uploadR2Object({ objectKey, mimeType: "text/plain", body: "User.Services R2 verification" })
          const downloaded = await downloadR2Object(objectKey)
          if (downloaded.buffer.toString("utf8") !== "User.Services R2 verification") throw new Error("R2 no devolvio el contenido de verificacion.")
        } finally {
          await deleteR2Object(objectKey).catch(() => undefined)
        }
      })
    }
    return Response.json({
      token: sealInscreenUserConfig(config),
      seedFingerprint: getInscreenConfigSeedFingerprint(),
      validatedAt: new Date().toISOString(),
      services: servicesStatus(config),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cifrar la configuracion." }, { status: 400 })
  }
}
