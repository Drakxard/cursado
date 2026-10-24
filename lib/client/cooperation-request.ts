/** Only replay reads and commits carrying the server's deduplication key. */
export async function cooperationRequest(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const replayable = method === 'GET' || method === 'POST' && /^spheres\/[^/]+\/operations$/.test(path) &&
    !!body && typeof body === 'object' && 'id' in body && typeof body.id === 'string' && !!body.id
  const options: RequestInit = { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' }
  const maxRetries = 3
  const failure = (attempt: number, detail: string) => new Error(`Cooperativo: ${method} ${path.split('?')[0]}. ${detail} (${attempt + 1} intento${attempt ? 's' : ''}; ${attempt} reintentos).`)
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(`/pizarra/api/cooperation/${path}`, options)
    } catch (error) {
      if (!replayable || attempt >= maxRetries || navigator.onLine === false) throw failure(attempt, `Error de conexión: ${error instanceof Error ? error.message : String(error)}`)
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
      continue
    }
    if (replayable && attempt < maxRetries && navigator.onLine !== false && [502, 503, 504].includes(response.status)) {
      await response.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
      continue
    }
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = result?.detail || result?.error || 'El servidor no devolvió un detalle de error.'
      throw failure(attempt, `HTTP ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
    if (result === null) throw failure(attempt, `HTTP ${response.status}: respuesta JSON inválida`)
    return result
  }
}
