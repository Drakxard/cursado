"use client"

import { pdfWorkspaceRoot } from "./subject-pdf-cache"
import { getReadyInscreenConfigToken } from "../local-workspace-client"

export function needsDatalabConfiguration(message: string) {
  return /semilla|INSCREEN_CONFIG_SEED|Falta configurar datalab|MARKER_API.*configurada|Datalab.*HTTP (401|403)|Clave de Datalab/i.test(message)
}

export async function datalabHeaders(): Promise<Record<string, string>> {
  const root = await pdfWorkspaceRoot()
  try {
    const saved = JSON.parse(await (await (await root.getFileHandle("User.Datalab")).getFile()).text())
    if (saved.version === 1 && typeof saved.token === "string" && saved.token) return { "x-datalab-config-token": saved.token }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
  }
  const token = getReadyInscreenConfigToken()
  return token ? { "x-inscreen-config-token": token } : {}
}

export async function saveDatalabKey(apiKey: string) {
  const root = await pdfWorkspaceRoot()
  const response = await fetch("/api/subject-voice/pdf-extraction/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) })
  const payload = await response.json()
  if (!response.ok || !payload.token) throw new Error(payload.error || "No se pudo guardar la clave.")
  const file = await root.getFileHandle("User.Datalab", { create: true })
  const writable = await file.createWritable()
  try { await writable.write(JSON.stringify({ version: 1, token: payload.token })) } finally { await writable.close() }
  const saved = JSON.parse(await (await file.getFile()).text())
  if (saved.token !== payload.token) throw new Error("No se pudo verificar el guardado.")
}
