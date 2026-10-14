import { DurableObject } from 'cloudflare:workers'

// Infrastructure only. The current Python API must not be redirected here yet.
// A room's stable name will be its shared content ID, independent of UI routes.
export class SharedContentRoom extends DurableObject {
  async checkStorage() {
    return this.ctx.storage.sql.exec('SELECT 1 AS ready').one().ready === 1
  }
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export default {
  async fetch(request, env, execution) {
    const url = new URL(request.url)
    if (url.pathname !== '/health' && url.pathname !== '/healthz') {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/recognize/')) {
        return json({ detail: 'La infraestructura está lista, pero la API de colaboración aún no está implementada.', code: 'COLLABORATION_NOT_IMPLEMENTED' }, 501)
      }
      return json({ detail: 'Ruta no encontrada.' }, 404)
    }
    if (request.method !== 'GET') return json({ detail: 'Método no permitido.' }, 405, { Allow: 'GET' })
    // Cache successful probes to avoid storage work for every public health check.
    const key = new Request(`${url.origin}/health`, { method: 'GET' })
    const cached = await caches.default.match(key)
    if (cached) return cached
    try {
      const [sqlite] = await Promise.all([
        env.CONTENT_ROOMS.getByName('infrastructure-health').checkStorage(),
        env.CONTENT_FILES.head(`${env.CONTENT_PREFIX}infrastructure-health`),
      ])
      if (!sqlite) throw new Error('Storage unavailable')
      const response = json({ ok: true, service: 'cursado-realtime', phase: 'infrastructure', collaborationReady: false,
        bindings: { durableObjects: true, sqlite: true, r2: true } }, 200, { 'Cache-Control': 'public, max-age=60' })
      execution.waitUntil(caches.default.put(key, response.clone()))
      return response
    } catch {
      return json({ ok: false, service: 'cursado-realtime', code: 'INFRASTRUCTURE_UNAVAILABLE' }, 503)
    }
  },
}
