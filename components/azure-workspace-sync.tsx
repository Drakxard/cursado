"use client"

import { useEffect, useState } from "react"
import { createIdleSync } from "@/lib/client/idle-sync"
import { getAzureSyncStatus, getAzureWorkspaceCode, restoreMissingAzureFiles, setAzureWorkspaceCode, syncLocalWorkspaceToAzure,
  type AzureSyncStatus, type AzureSyncSummary } from "@/lib/client/azure-workspace-sync"

export function useAzureWorkspaceSync(root: FileSystemDirectoryHandle | null, enabled: boolean, auto: boolean) {
  const [status, setStatus] = useState<AzureSyncStatus | null>(null)
  const [summary, setSummary] = useState<AzureSyncSummary | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!enabled || !root) return
    let cancelled = false
    const run = async (synchronize = false) => {
      try {
        const current = await getAzureSyncStatus(true)
        if (cancelled) return
        setStatus(current)
        if (!current.configured) return synchronize ? false : undefined
        setCode(await getAzureWorkspaceCode(root))
        if (!current.connected) {
          setError(current.error || "No se pudo conectar Azure.")
          if (synchronize) throw new Error(current.error || "No se pudo conectar Azure.")
          return
        }
        if (!auto || !synchronize) return
        setBusy(true)
        const result = await syncLocalWorkspaceToAzure(root, value => { if (!cancelled) setSummary(value) })
        if (!cancelled) { setSummary(result); setError("") }
        if (result.failed) throw new Error(result.errors[0] || "Hay archivos pendientes de sincronización.")
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "No se pudo sincronizar Azure.")
        if (synchronize) throw failure
      }
      finally { if (!cancelled) setBusy(false) }
    }
    const scheduler = createIdleSync({
      storageKey: auto ? 'cursado-azure-pending-sync' : undefined,
      run: async () => { if (cancelled || !navigator.onLine) return false; return run(true) },
    })
    void run()
    if (auto) scheduler.request()
    const online = () => { if (auto) scheduler.request(); else void run() }
    const saved = () => { if (auto) scheduler.request() }
    const channel = new BroadcastChannel('cursado-library-changes')
    channel.onmessage = saved
    window.addEventListener("cursado-workspace-saved", saved)
    window.addEventListener("online", online)
    window.addEventListener("cursado-services-changed", online)
    return () => { cancelled = true; scheduler.stop(); channel.close(); window.removeEventListener("cursado-workspace-saved", saved); window.removeEventListener("online", online); window.removeEventListener("cursado-services-changed", online) }
  }, [root, enabled, auto])

  const sync = async () => {
    if (!root) return
    setBusy(true); setError(""); setMessage("")
    try {
      const current = await getAzureSyncStatus(true); setStatus(current)
      const result = await syncLocalWorkspaceToAzure(root, setSummary)
      setSummary(result); setCode(result.workspaceId)
      setMessage(result.failed ? "Algunos archivos quedaron pendientes de reintento." : "Copia de Azure actualizada.")
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo sincronizar Azure.") }
    finally { setBusy(false) }
  }
  const recover = async (sourceCode: string) => {
    if (!root) return
    setBusy(true); setError(""); setMessage("")
    try {
      if (sourceCode.trim() !== code) { await setAzureWorkspaceCode(root, sourceCode); setCode(sourceCode.trim()) }
      const result = await restoreMissingAzureFiles(root)
      setMessage(`${result.restored} archivos recuperados; ${result.skipped} archivos locales conservados. Recargá la página para abrirlos.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo recuperar Azure.") }
    finally { setBusy(false) }
  }
  return { status, summary, code, busy, error, message, sync, recover }
}

export function AzureWorkspaceSyncControls({ sync }: { sync: ReturnType<typeof useAzureWorkspaceSync> }) {
  const [sourceCode, setSourceCode] = useState("")
  if (!sync.status?.configured) return null
  return <div className="mt-4 space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm">
    <p className="font-semibold">Azure Blob Storage · {sync.status.account || "Conexión del despliegue"}</p>
    <p className="text-xs text-slate-600">PDFs, audios, síntesis, transcripciones y explicaciones se copian a Azure automáticamente. Contenedor: {sync.status.container || "cursado2026"}.</p>
    {sync.summary ? <p>{sync.summary.synced} sincronizados · {sync.summary.pending} pendientes · {sync.summary.failed} con error</p> : null}
    {sync.busy ? <p role="status">Sincronizando… {sync.summary?.activePath}</p> : null}
    {sync.summary?.errors.map(value => <p className="break-words text-xs text-amber-800" key={value}>{value}</p>)}
    {sync.code ? <div><p className="text-xs">Código para recuperar esta carpeta en otro dispositivo:</p><code className="break-all text-xs">{sync.code}</code></div> : null}
    <button type="button" disabled={sync.busy} onClick={() => { void sync.sync() }} className="rounded-xl bg-sky-700 px-3 py-2 text-white disabled:opacity-50">Sincronizar ahora</button>
    <label className="block text-xs">Código de la carpeta de Azure<input value={sourceCode} onChange={event => setSourceCode(event.target.value)} placeholder={sync.code} disabled={sync.busy} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2" /></label>
    <button type="button" disabled={sync.busy || !sync.status.connected} onClick={() => { void sync.recover(sourceCode.trim() || sync.code) }} className="rounded-xl border border-sky-300 px-3 py-2 disabled:opacity-50">Recuperar archivos faltantes</button>
    {sync.error ? <p role="alert" className="text-red-700">{sync.error}</p> : null}
    {sync.message ? <p role="status" className="text-emerald-800">{sync.message}</p> : null}
  </div>
}
