export type BoardChatMessage = { role: 'user' | 'assistant'; content: string }
export function boardChatInput(value: unknown) {
  const body = value as Record<string, unknown> | null
  if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 12000) throw new Error('Escribí una pregunta de hasta 12000 caracteres.')
  const image = body.image
  if (image !== undefined && (typeof image !== 'string' || image.length > 4_000_000 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) throw new Error('La captura no es válida o supera el tamaño permitido.')
  const context = body.context ?? []
  if (!Array.isArray(context) || context.length > 20 || context.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 60000) || JSON.stringify(context).length > 120000) throw new Error('El contexto de la conversación supera el límite permitido. Abrí una nueva sesión.')
  return { question: body.question.trim(), image: image as string | undefined, context: context as BoardChatMessage[] }
}
