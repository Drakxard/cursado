import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export function sealLibraryToken(purpose: string, value: unknown, secret = process.env.INSCREEN_PROVIDER_CAPSULE_SECRET || '') {
  if (Buffer.byteLength(secret) < 32) throw new Error('Falta INSCREEN_PROVIDER_CAPSULE_SECRET (mínimo 32 caracteres).')
  const key = createHash('sha256').update(`workspace-library:${purpose}:v1\0${secret}`).digest()
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(purpose))
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return ['wl1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}
export function openLibraryToken<T>(purpose: string, token: string, secret = process.env.INSCREEN_PROVIDER_CAPSULE_SECRET || ''): T {
  if (Buffer.byteLength(secret) < 32) throw new Error('Falta INSCREEN_PROVIDER_CAPSULE_SECRET.')
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'wl1' || token.length > 16000 || !parts.slice(1).every(p => /^[a-zA-Z0-9_-]+$/.test(p))) throw new Error('Credencial inválida.')
  try {
    const key = createHash('sha256').update(`workspace-library:${purpose}:v1\0${secret}`).digest()
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'))
    cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(parts[3], 'base64url')), cipher.final()]).toString()) as T
  } catch { throw new Error('Credencial inválida.') }
}
