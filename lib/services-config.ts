export const EXTRA_SERVICE_FIELDS = [
  'storage_azure', 'storage_azure_container', 'gpt5mini', 'conexiongpt5mini',
  'AZURE_OPENAI_DEPLOYMENT', 'gatewayia', 'datalab', 'cloudflareapi', 'CLOUDFLARE_ACCOUNT_ID',
] as const
export type ExtraServiceField = typeof EXTRA_SERVICE_FIELDS[number]
export const SERVICE_FIELDS = ['GROQ_API_KEY', 'MARKER_API', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', ...EXTRA_SERVICE_FIELDS] as const
export type ServiceField = typeof SERVICE_FIELDS[number]
export type ServicesDraft = Record<ServiceField, string>
export const emptyServicesDraft = () => Object.fromEntries(SERVICE_FIELDS.map(field => [field, ''])) as ServicesDraft

export const SERVICE_GROUPS = [
  { id: 'azureStorage', name: 'Respaldo en Azure', fields: ['storage_azure', 'storage_azure_container'] },
  { id: 'azureGpt', name: 'Verlo · Azure', fields: ['gpt5mini', 'conexiongpt5mini', 'AZURE_OPENAI_DEPLOYMENT'] },
  { id: 'gateway', name: 'AI Gateway', fields: ['gatewayia'] },
  { id: 'datalab', name: 'Datalab · PDF', fields: ['datalab'] },
  { id: 'cloudflareVoice', name: 'Cloudflare · Voz', fields: ['cloudflareapi', 'CLOUDFLARE_ACCOUNT_ID'] },
  { id: 'groq', name: 'Groq', fields: ['GROQ_API_KEY'] },
  { id: 'r2', name: 'Cloudflare R2', fields: ['R2_BUCKET_NAME', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] },
] as const
export type ServiceGroup = typeof SERVICE_GROUPS[number]['id']
export type ServicesStatus = { groq: boolean; r2: boolean } & Partial<Record<ServiceGroup, boolean>>

export function servicesStatus(config: Partial<ServicesDraft>): ServicesStatus {
  return {
    groq: Boolean(config.GROQ_API_KEY), r2: Boolean(config.R2_BUCKET_NAME && config.R2_ENDPOINT && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY),
    azureStorage: Boolean(config.storage_azure), azureGpt: Boolean(config.gpt5mini && config.conexiongpt5mini),
    gateway: Boolean(config.gatewayia), datalab: Boolean(config.datalab || config.MARKER_API),
    cloudflareVoice: Boolean(config.cloudflareapi && config.CLOUDFLARE_ACCOUNT_ID),
  }
}

export function isServicesServerRequest(path: string) {
  return path === '/api/pdf-explanation' || path === '/api/pdf-translate' || path === '/api/synthesis-voice'
    || path === '/api/tts' || path.startsWith('/api/subject-voice') || path.startsWith('/api/storage/azure')
    || path.startsWith('/api/inscreen/')
}
