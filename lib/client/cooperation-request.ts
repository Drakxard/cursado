/** Only replay reads and commits carrying the server's deduplication key. */
export async function cooperationRequest(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const replayable = method === 'GET' || method === 'POST' && /^spheres\/[^/]+\/operations$/.test(path) &&
    !!body && typeof body === 'object' && 'id' in body && typeof body.id === 'string' && !!body.id
  const options: RequestInit = { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' }
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(`/pizarra/api/cooperation/${path}`, options)
    } catch (error) {
      if (!replayable || attempt >= 2 || navigator.onLine === false) throw error
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
      continue
    }
    if (replayable && attempt < 2 && navigator.onLine !== false && [502, 503, 504].includes(response.status)) {
      await response.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
      continue
    }
    const result = await response.json().catch(error => { if (response.ok) throw error; return {} })
    if (!response.ok) throw new Error(result.detail || result.error || 'No se pudo conectar con Cooperativo.')
    return result
  }
}
