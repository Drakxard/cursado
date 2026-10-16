import { AsyncLocalStorage } from "node:async_hooks"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { EXTRA_SERVICE_FIELDS, SERVICE_FIELDS, type ExtraServiceField } from './services-config.ts'

export const INSCREEN_CONFIG_COOKIE = "inscreen_config_b"
export const INSCREEN_CONFIG_HALF_HEADER = "x-inscreen-config-half"
export const INSCREEN_CONFIG_TOKEN_HEADER = "x-inscreen-config-token"

export type InscreenUserConfig = Partial<Record<ExtraServiceField, string>> & {
  GROQ_API_KEY: string
  MARKER_API: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_ENDPOINT: string
}

export type InscreenR2Config = Pick<
  InscreenUserConfig,
  "R2_BUCKET_NAME" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_ENDPOINT"
>

const runtimeConfig = new AsyncLocalStorage<InscreenUserConfig>()
const CONFIG_FIELDS = [
  "GROQ_API_KEY",
  "MARKER_API",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
] as const

function getSeed(suppliedSeed?: string) {
  const seed = String(suppliedSeed ?? process.env.INSCREEN_CONFIG_SEED ?? "").trim()
  if (seed.length < 32) throw new Error("INSCREEN_CONFIG_SEED debe tener al menos 32 caracteres.")
  return createHash("sha256").update(seed).digest()
}

export function getInscreenConfigSeedFingerprint() {
  return createHash("sha256").update(getSeed()).update("services-file-v1").digest("hex").slice(0, 16)
}

export function normalizeInscreenUserConfig(value: unknown): InscreenUserConfig {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const config = Object.fromEntries(CONFIG_FIELDS.map((field) => [field, String(input[field] || "").trim()])) as InscreenUserConfig
  for (const field of EXTRA_SERVICE_FIELDS) {
    if (input[field] !== undefined && typeof input[field] !== 'string') throw new Error(`${field} debe ser texto.`)
    const entry = String(input[field] || '').trim()
    // Keep the original token shape when opening older User.Services files.
    if (entry) config[field] = entry
  }
  if ((config.gpt5mini || config.conexiongpt5mini || config.AZURE_OPENAI_DEPLOYMENT) && (!config.gpt5mini || !config.conexiongpt5mini)) throw new Error('Completá la clave y el endpoint de Azure para Verlo.')
  if (config.storage_azure_container && !config.storage_azure) throw new Error('Completá la cadena de conexión de Azure Storage.')
  if (config.conexiongpt5mini) {
    let url: URL
    try { url = new URL(config.conexiongpt5mini) } catch { throw new Error('El endpoint de Azure no es válido.') }
    const path = url.pathname.replace(/\/+$/, '')
    if (url.protocol !== 'https:' || !/\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/.test(url.hostname)
      || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')
      || (path && !/^\/openai(?:\/v1)?$/.test(path) && !/^\/api\/projects\/[^/]+(?:\/openai(?:\/v1)?)?$/.test(path))) throw new Error('Usá el endpoint HTTPS oficial del recurso o proyecto Azure, sin /responses ni claves en la URL.')
  }
  if ((config.cloudflareapi || config.CLOUDFLARE_ACCOUNT_ID) && (!config.cloudflareapi || !config.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Completá el token y el identificador de cuenta de Cloudflare.')
  if (config.CLOUDFLARE_ACCOUNT_ID && !/^[a-f0-9]{32}$/i.test(config.CLOUDFLARE_ACCOUNT_ID)) throw new Error('El identificador de cuenta de Cloudflare debe tener 32 caracteres hexadecimales.')
  if (config.storage_azure) {
    const parts = Object.fromEntries(config.storage_azure.split(';').filter(Boolean).map(part => { const at = part.indexOf('='); return [part.slice(0, at).trim(), part.slice(at + 1).trim()] }))
    if (parts.DefaultEndpointsProtocol && parts.DefaultEndpointsProtocol !== 'https') throw new Error('La conexión de Azure debe usar HTTPS.')
    if (parts.EndpointSuffix && !['core.windows.net', 'core.usgovcloudapi.net', 'core.chinacloudapi.cn', 'core.cloudapi.de'].includes(parts.EndpointSuffix)) throw new Error('Usá una cadena de conexión oficial de Azure Storage.')
    if (!parts.AccountKey && !parts.SharedAccessSignature) throw new Error('Pegá la cadena de conexión completa de Azure Storage.')
    if (!parts.AccountName && !parts.BlobEndpoint) throw new Error('La conexión de Azure no contiene una cuenta o un endpoint Blob.')
    if (parts.AccountName && !/^[a-z0-9]{3,24}$/.test(parts.AccountName)) throw new Error('El nombre de cuenta de Azure Storage no es válido.')
    for (const key of ['BlobEndpoint', 'QueueEndpoint', 'TableEndpoint', 'FileEndpoint']) {
      if (!parts[key]) continue
      let url: URL
      try { url = new URL(parts[key]) } catch { throw new Error('La cadena de conexión de Azure tiene un endpoint inválido.') }
      if (url.protocol !== 'https:' || !/^[a-z0-9]+\.(?:blob|queue|table|file)\.core\.(?:windows\.net|usgovcloudapi\.net|chinacloudapi\.cn|cloudapi\.de)$/.test(url.hostname)
        || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('La cadena de conexión debe usar endpoints HTTPS oficiales de Azure Storage.')
    }
  }
  if (config.storage_azure_container && (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.storage_azure_container) || config.storage_azure_container.includes('--'))) throw new Error('El nombre del contenedor de Azure no es válido.')
  const r2Fields = [config.R2_BUCKET_NAME, config.R2_ACCESS_KEY_ID, config.R2_SECRET_ACCESS_KEY, config.R2_ENDPOINT]
  if (r2Fields.some(Boolean) && !r2Fields.every(Boolean)) throw new Error("Completa todos los campos de Cloudflare R2.")
  if (config.R2_ENDPOINT) {
    const endpoint = new URL(config.R2_ENDPOINT)
    if (
      endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash ||
      !/^[a-z0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname)
    ) throw new Error("R2_ENDPOINT debe ser un endpoint S3 oficial de Cloudflare R2.")
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.R2_BUCKET_NAME)) throw new Error("R2_BUCKET_NAME invalido.")
  }
  for (const field of SERVICE_FIELDS) {
    if (Buffer.byteLength(config[field] || '', "utf8") > 4096) throw new Error(`${field} es demasiado largo.`)
  }
  if (Buffer.byteLength(JSON.stringify(config), 'utf8') > 8000) throw new Error('La configuración es demasiado grande para enviarla de forma segura.')
  return config
}

export function getInscreenR2Config(config: InscreenUserConfig): InscreenR2Config {
  return {
    R2_BUCKET_NAME: config.R2_BUCKET_NAME,
    R2_ACCESS_KEY_ID: config.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: config.R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT: config.R2_ENDPOINT,
  }
}

export function sealInscreenUserConfig(value: unknown) {
  const config = normalizeInscreenUserConfig(value)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getSeed(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".")
}

export function openInscreenUserConfig(token: string, suppliedSeed?: string) {
  const parts = String(token || "").split(".")
  const [version, ivValue, tagValue, ciphertextValue] = parts
  if (parts.length !== 4 || version !== "v1" || !ivValue || !tagValue || !ciphertextValue || token.length > 12_000
    || !parts.slice(1).every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Configuracion InScreen invalida.")
  try {
    const decipher = createDecipheriv("aes-256-gcm", getSeed(suppliedSeed), Buffer.from(ivValue, "base64url"))
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8")
    return normalizeInscreenUserConfig(JSON.parse(plaintext))
  } catch {
    throw new Error("No se pudo desbloquear User.Services con la semilla de este despliegue.")
  }
}

export function splitInscreenUserConfig(value: unknown) {
  const sealedConfig = sealInscreenUserConfig(value)
  const midpoint = Math.ceil(sealedConfig.length / 2)
  return {
    fileHalf: sealedConfig.slice(0, midpoint),
    cookieHalf: sealedConfig.slice(midpoint),
  }
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || ""
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return ""
}

export function readInscreenUserConfig(request: Request) {
  const token = String(request.headers.get(INSCREEN_CONFIG_TOKEN_HEADER) || "").trim()
  if (!token) throw new Error("Falta la configuracion InScreen en User.Services.")
  return openInscreenUserConfig(token)
}

export function readLegacyInscreenUserConfig(request: Request, suppliedFileHalf = "") {
  const fileHalf = String(suppliedFileHalf || request.headers.get(INSCREEN_CONFIG_HALF_HEADER) || "").trim()
  const cookieHalf = readCookie(request, INSCREEN_CONFIG_COOKIE)
  if (!fileHalf || !cookieHalf) throw new Error("Falta una mitad de la configuracion InScreen.")
  return openInscreenUserConfig(`${fileHalf}${cookieHalf}`)
}

export function openInscreenUserConfigParts(fileHalf: string, request: Request) {
  return readLegacyInscreenUserConfig(request, fileHalf)
}

export async function withInscreenUserConfig(request: Request, handler: () => Promise<Response>) {
  let config: InscreenUserConfig
  try {
    config = readInscreenUserConfig(request)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Configuracion InScreen requerida.", configurationRequired: true },
      { status: 428 }
    )
  }
  return runtimeConfig.run(config, handler)
}

export function withOptionalServicesConfig(request: Request, handler: () => Promise<Response>) {
  return request.headers.get(INSCREEN_CONFIG_TOKEN_HEADER) ? withInscreenUserConfig(request, handler) : handler()
}

export function withInscreenRuntimeConfig<T>(config: InscreenUserConfig | InscreenR2Config, handler: () => T) {
  return runtimeConfig.run({
    GROQ_API_KEY: "",
    MARKER_API: "",
    ...config,
  }, handler)
}

export function getInscreenRuntimeSecret(name: keyof InscreenUserConfig) {
  if (name === 'MARKER_API') return runtimeConfig.getStore()?.datalab || runtimeConfig.getStore()?.MARKER_API || ''
  return runtimeConfig.getStore()?.[name] || ""
}

export function buildInscreenConfigCookie(cookieHalf: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${INSCREEN_CONFIG_COOKIE}=${encodeURIComponent(cookieHalf)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`
}

export function clearInscreenConfigCookie() {
  return buildInscreenConfigCookie("").replace("Max-Age=31536000", "Max-Age=0")
}
