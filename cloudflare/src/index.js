import { DurableObject } from 'cloudflare:workers'
import { apiJson } from './auth.js'
export { IdentityDirectory } from './auth.js'

// Authentication is available; shared content synchronization remains a separate release.
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
    if (url.pathname.startsWith('/api/auth/') || ['/api/library','/api/calendars','/api/calendar/events'].includes(url.pathname)) {
      const supported = ['/api/auth/me','/api/auth/guest','/api/auth/login','/api/auth/logout','/api/auth/avatar','/api/auth/set-password','/api/library','/api/calendars','/api/calendar/events']
      if (!supported.includes(url.pathname)) return apiJson({detail:'Esta función todavía no está disponible.'},501)
      const read = ['/api/auth/me','/api/library','/api/calendars','/api/calendar/events'].includes(url.pathname)
      if (request.method !== (read ? 'GET' : 'POST')) return apiJson({detail:'Método no permitido.'},405,{Allow:read?'GET':'POST'})
      if (!read) {
        if (request.headers.get('origin') !== env.CURSADO_ORIGIN) return apiJson({detail:'Origen no permitido.'},403)
        if (url.pathname !== '/api/auth/logout' && !(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return apiJson({detail:'Usá JSON para enviar los datos.'},415)
        // Enforce the body limit even for streamed requests without Content-Length.
        const reader = request.body?.getReader(), chunks = []; let length = 0
        if (reader) {
          while (true) {
            const part = await reader.read(); if (part.done) break
            length += part.value.byteLength
            if (length > 16384) { await reader.cancel(); return apiJson({detail:'La solicitud es demasiado grande.'},413) }
            chunks.push(part.value)
          }
        }
        const body = new Uint8Array(length); let offset = 0
        for (const part of chunks) { body.set(part,offset); offset += part.byteLength }
        request = new Request(request.url,{method:request.method,headers:request.headers,body:body.length ? body : undefined})
      }
      try { return await env.IDENTITY_DIRECTORY.getByName('pizarra-identities-v1').fetch(request) }
      catch { return apiJson({detail:'No se pudo conectar con el servicio de acceso.'},503) }
    }
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
      const response = json({ ok: true, service: 'cursado-realtime', phase: 'authentication', authenticationReady: Boolean(env.AUTH_PEPPER && env.IDENTITY_DIRECTORY), collaborationReady: false,
        bindings: { durableObjects: true, sqlite: true, r2: true } }, 200, { 'Cache-Control': 'public, max-age=60' })
      execution.waitUntil(caches.default.put(key, response.clone()))
      return response
    } catch {
      return json({ ok: false, service: 'cursado-realtime', code: 'INFRASTRUCTURE_UNAVAILABLE' }, 503)
    }
  },
}
