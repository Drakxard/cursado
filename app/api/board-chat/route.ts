import { generateText, type ModelMessage } from 'ai'
import { requireAuthSession } from '@/lib/authz'
import { withOptionalServicesConfig } from '@/lib/inscreen-user-config'
import { azureExplanationConfig, azureExplanationModel } from '@/lib/server/pdf-explanation-azure'
import { boardChatInput } from '@/lib/board-chat'

export const runtime = 'nodejs'
export const maxDuration = 300
const headers = { 'Cache-Control': 'no-store' }
async function handle(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  let input: ReturnType<typeof boardChatInput>
  try {
    const raw = await request.text()
    if (raw.length > 4_300_000) return Response.json({ error: 'La captura supera el tamaño permitido.' }, { status: 413, headers })
    input = boardChatInput(JSON.parse(raw))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Solicitud inválida.' }, { status: 400, headers })
  }
  try {
    const config = azureExplanationConfig()
    if (!config) return Response.json({ error: 'Configurá GPT-5 mini en la estrella → Verlo / API chat · Azure: clave y endpoint.', configurationRequired: true }, { status: 428, headers })
    const messages: ModelMessage[] = [...input.context, { role: 'user', content: [
      { type: 'text', text: input.question },
      ...(input.image ? [{ type: 'image' as const, image: input.image }] : []),
    ] }]
    const result = await generateText({ model: azureExplanationModel(config), messages,
      system: 'Respondé en español a la consulta del usuario usando la captura de la pizarra cuando esté adjunta y el contexto de la conversación. No inventes contenido ilegible. Usá fórmulas LaTeX compatibles con KaTeX: \\( ... \\) en línea y \\[ ... \\] centradas. Podés usar **negrita** y *cursiva*. No uses HTML.',
      maxOutputTokens: 12000, abortSignal: request.signal,
    })
    if (!result.text.trim()) throw new Error('El modelo devolvió una respuesta vacía. Intentá nuevamente.')
    return Response.json({ answer: result.text }, { headers })
  } catch {
    return Response.json({ error: 'No se pudo consultar GPT-5 mini. Revisá la clave, el endpoint y el despliegue en la estrella; podés reintentar.' }, { status: 502, headers })
  }
}
export function POST(request: Request) { return withOptionalServicesConfig(request, () => handle(request)) }
