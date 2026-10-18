import { requireAuthSession } from "@/lib/authz"
import { convertPdfPageWithDatalabMarker, DatalabMarkerError } from "@/lib/datalab-marker"
import { INSCREEN_CONFIG_TOKEN_HEADER, withInscreenUserConfig, openInscreenUserConfig, withInscreenRuntimeConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_PAGE_PDF_BYTES = 25 * 1024 * 1024

async function transcribe(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File) || file.type !== "application/pdf") {
      return Response.json({ error: "Se requiere un PDF de una pagina." }, { status: 400 })
    }
    if (!file.size || file.size > MAX_PAGE_PDF_BYTES) {
      return Response.json({ error: "El PDF de la pagina supera el limite permitido." }, { status: 413 })
    }

    const markdown = await convertPdfPageWithDatalabMarker({ file })
    return Response.json({ markdown })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo transcribir la pagina con Datalab."
    const status = error instanceof DatalabMarkerError ? 502 : 500
    console.error("POST /api/inscreen/datalab-transcribe error:", error)
    return Response.json({ error: message }, { status })
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("x-datalab-config-token")
  if (token) {
    try {
      const config = openInscreenUserConfig(token)
      if (!config.datalab) throw new Error()
      return withInscreenRuntimeConfig(config, () => transcribe(request))
    } catch {
      return Response.json({ error: "Clave de Datalab no disponible. Volvé a cargarla." }, { status: 428 })
    }
  }
  if (!request.headers.get(INSCREEN_CONFIG_TOKEN_HEADER)) {
    return transcribe(request)
  }
  return withInscreenUserConfig(request, () => transcribe(request))
}
