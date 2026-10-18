export const DEFAULT_EXPLANATION_INSTRUCTIONS = "Explicaci\u00f3n visual e interactiva paso a paso. Us\u00e1 texto, f\u00f3rmulas, tablas y diagramas cuando ayuden a entender; conserv\u00e1 las etiquetas del apunte y aclar\u00e1 las incertidumbres."

export function explanationInput(body: unknown) {
  const data = body as Record<string, unknown> | null
  const question = typeof data?.question === "string" ? data.question.trim() || "Explicalo" : ""
  const transcription = typeof data?.transcription === "string" ? data.transcription.trim() : ""
  if (!question || question.length > 2000 || !transcription || transcription.length > 180_000) {
    throw new Error("Ingresá una duda y una transcripción de página válidas.")
  }
  const instructions = data?.instructions
  if (instructions !== undefined && (typeof instructions !== "string" || !instructions.trim() || instructions.length > 4000)) throw new Error("La instrucción final no es válida.")
  const systemPrompt = data?.systemPrompt
  if (systemPrompt !== undefined && (typeof systemPrompt !== "string" || !systemPrompt.trim() || systemPrompt.length > 100_000)) throw new Error("El prompt de sistema debe contener entre 1 y 100000 caracteres.")
  const image = data?.image
  if (image !== undefined && (typeof image !== "string" || image.length > 4_000_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) {
    throw new Error("La región adjunta no es una imagen válida.")
  }
  return { question, transcription, ...(typeof instructions === "string" ? { instructions: instructions.trim() } : {}), ...(typeof systemPrompt === "string" ? { systemPrompt } : {}), ...(typeof image === "string" ? { image } : {}) }
}

export function explanationPrompt(question: string, transcription: string) {
  return `${question}\n\n${transcription}`
}

export function explanationHtml(text: string) {
  const html = text.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim()
  if (html.length > 1_500_000 || !/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error("El modelo no devolvió un documento HTML completo. Volvé a intentarlo.")
  }
  // Defense in depth: the viewer also uses an opaque-origin sandbox with no network access.
  return html.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`)
}
