import { DEFAULT_EXPLANATION_INSTRUCTIONS } from "./pdf-explanation.ts"

// Shared by the server and the gear preview: both compose the exact same message.
export function composeExplanationSystem(base: string, instructions = DEFAULT_EXPLANATION_INSTRUCTIONS): string {
  return `${base}\n\nPREFERENCIAS DEL USUARIO\nAplicá estas preferencias al idioma, detalle y pedagogía, respetando el contrato JSON elegido:\n${instructions.trim()}`
}
