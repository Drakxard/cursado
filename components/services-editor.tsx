"use client"

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SERVICE_GROUPS, type ServiceField, type ServiceGroup, type ServicesDraft, type ServicesStatus } from '@/lib/services-config'

const labels: Partial<Record<ServiceField, string>> = {
  storage_azure: 'Cadena de conexiÃ³n', storage_azure_container: 'Contenedor (opcional)',
  gpt5mini: 'Clave de Azure', conexiongpt5mini: 'Endpoint del recurso o proyecto', AZURE_OPENAI_DEPLOYMENT: 'Nombre del despliegue (opcional)',
  gatewayia: 'Clave de AI Gateway', datalab: 'Clave de Datalab', cloudflareapi: 'Token de Cloudflare', CLOUDFLARE_ACCOUNT_ID: 'Identificador de cuenta',
  GROQ_API_KEY: 'Clave de Groq', R2_BUCKET_NAME: 'Bucket', R2_ENDPOINT: 'Endpoint S3', R2_ACCESS_KEY_ID: 'Identificador de acceso', R2_SECRET_ACCESS_KEY: 'Clave secreta',
}
const publicFields = new Set<ServiceField>(['storage_azure_container', 'conexiongpt5mini', 'AZURE_OPENAI_DEPLOYMENT', 'CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ENDPOINT'])

export function ServicesEditor({ replacingServices = false, values, status, initialGroup, busy, error, onChange, onSave, onClose }: {
  replacingServices?: boolean; values: ServicesDraft; status: ServicesStatus; initialGroup: ServiceGroup; busy: boolean; error: string
  onChange: (field: ServiceField, value: string) => void; onSave: () => void; onClose: () => void
}) {
  const [selected, setSelected] = useState<ServiceGroup>(initialGroup)
  const [visible, setVisible] = useState(false)
  const group = SERVICE_GROUPS.find(group => group.id === selected)!
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 sm:max-w-lg" aria-describedby="services-editor-description">
      <DialogTitle>Configurar servicios</DialogTitle>
      <DialogDescription id="services-editor-description">Se guardan cifrados en User.Services, dentro de tu carpeta.</DialogDescription>
      {replacingServices ? <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">Volvé a pegar las claves de los servicios que usás. Se guardarán cifradas con la semilla actual; las claves anteriores no se pueden conservar. Podés cambiar de servicio para completar varios antes de guardar.</p> : null}
      <form onSubmit={event => { event.preventDefault(); onSave() }} className="space-y-4">
        <label className="block text-sm font-medium">Servicio
          <select aria-label="Servicio" className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value as ServiceGroup); setVisible(false) }}>
            {SERVICE_GROUPS.map(group => <option key={group.id} value={group.id}>{group.name}{status[group.id] ? ' Â· Configurado' : ''}</option>)}
          </select>
        </label>
        {status[group.id] ? <p className="text-xs text-emerald-700">Ya configurado. Los campos vacÃ­os conservan los valores guardados.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {group.fields.map(field => <label key={field} className={`block text-sm font-medium ${field === 'storage_azure' || field === 'conexiongpt5mini' || field === 'R2_ENDPOINT' ? 'sm:col-span-2' : ''}`}>
            {labels[field] || field}
            <input aria-label={labels[field] || field} type={publicFields.has(field) ? 'text' : visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} autoCapitalize="off"
              maxLength={4096} disabled={busy} value={values[field]} onChange={event => onChange(field, event.target.value)}
              placeholder={field === 'storage_azure_container' ? 'cursado2026' : field === 'AZURE_OPENAI_DEPLOYMENT' ? 'gpt-5-mini' : status[group.id] ? 'Conservar valor guardado' : ''}
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
            <span className="mt-1 block text-[10px] font-normal text-slate-500">{field}</span>
          </label>)}
        </div>
        <button type="button" onClick={() => setVisible(value => !value)} className="text-xs text-sky-700 underline">{visible ? 'Ocultar claves' : 'Mostrar claves'}</button>
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2 text-sm">Volver</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardandoâ€¦' : 'Guardar cifrado'}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
