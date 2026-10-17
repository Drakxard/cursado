"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { saveDatalabKey } from "@/lib/client/datalab-config"

export function DatalabApiCard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent className="rounded-2xl sm:max-w-sm">
      <DialogTitle>Agregar API de Datalab</DialogTitle>
      <DialogDescription>Para leer tus PDF con OCR, incluso si son escaneados.</DialogDescription>
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault()
        if (saving || !key.trim()) return
        setSaving(true); setError("")
        try { await saveDatalabKey(key.trim()); setKey(""); onSaved() }
        catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar.") }
        finally { setSaving(false) }
      }}>
        <label className="block text-sm">API key
          <input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={4096} disabled={saving} placeholder="Pegá tu clave" className="mt-1 w-full rounded-lg border bg-background px-3 py-2" />
        </label>
        <p className="text-xs text-muted-foreground">Copiala de <a href="https://www.datalab.to/app/keys" target="_blank" rel="noopener noreferrer" className="underline">Datalab</a>. Se guarda cifrada.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted-foreground">Ahora no</button>
          <button type="submit" disabled={saving || !key.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? "Guardando..." : "Guardar y reintentar"}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
