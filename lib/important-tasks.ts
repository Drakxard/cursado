import { withWorkspaceFileLock } from './workspace-file-lock.ts'
import { mergeCooperation, type Json } from './cooperation-model.ts'
export type ImportantTask = {
  cooperation?: { shareId: string; deliveryId: string }
  id: string
  text: string
  startDate: string
  dueDate: string
  url: string
  topics: string[]
  topicBoardIds?: string[]
}

export function importantTaskProgress(task: ImportantTask, today = new Date()) {
  const day = (value: string) => {
    const [year, month, date] = value.split("-").map(Number)
    return Date.UTC(year, month - 1, date)
  }
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const total = Math.max(1, Math.round((day(task.dueDate) - day(task.startDate)) / 86400000))
  const remaining = Math.max(0, Math.ceil((day(task.dueDate) - now) / 86400000))
  const elapsed = Math.max(0, Math.min(total, total - remaining))
  return { total, remaining, elapsed, percentage: Math.round(elapsed / total * 100) }
}

export async function readImportantTasks(root: FileSystemDirectoryHandle, requirePublished = false): Promise<ImportantTask[]> {
  let text: string
  try {
    const directory = await root.getDirectoryHandle("progreso")
    text = await (await (await directory.getFileHandle("importantes.json")).getFile()).text()
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      if (requirePublished) throw new Error("Importantes todavía no está en esta publicación. Abrí la web con tu carpeta, sincronizá los dispositivos y luego actualizá los archivos en InScreen.")
      return []
    }
    throw error
  }
  const data = JSON.parse(text)
  if (data.version !== 1 || !Array.isArray(data.tasks) || !data.tasks.every((task: ImportantTask) =>
    task && typeof task.id === "string" && typeof task.text === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(task.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) &&
    typeof task.url === "string" && Array.isArray(task.topics) && task.topics.every(topic => typeof topic === "string") &&
    (task.cooperation === undefined || (!!task.cooperation && /^[a-f0-9-]{36}$/.test(task.cooperation.shareId) && /^[a-f0-9-]{36}$/.test(task.cooperation.deliveryId))) &&
    (task.topicBoardIds === undefined || (Array.isArray(task.topicBoardIds) && task.topicBoardIds.length === task.topics.length && task.topicBoardIds.every(id => /^[a-zA-Z0-9-]{1,100}$/.test(id))))
  )) throw new Error("El archivo de importantes no tiene un formato válido.")
  return data.tasks
}

export async function writeImportantTasks(root: FileSystemDirectoryHandle, tasks: ImportantTask[], baseline?: ImportantTask[]) {
 return withWorkspaceFileLock('important-tasks', async () => {
  if (baseline) tasks = mergeCooperation(baseline as unknown as Json, tasks as unknown as Json, await readImportantTasks(root) as unknown as Json) as unknown as ImportantTask[]
  const directory = await root.getDirectoryHandle("progreso", { create: true })
  const file = await directory.getFileHandle("importantes.json", { create: true })
  const writer = await file.createWritable()
  await writer.write(JSON.stringify({ version: 1, tasks }, null, 2))
  await writer.close()
  if (typeof window !== "undefined") window.dispatchEvent(new Event("cursado-workspace-saved"))
  return tasks
 })
}

export function importantCountdownStyle(days: number) {
  return days === 1 ? {kind:'urgent' as const,from:'#f97316',to:'#ef4444'}
    : days >= 3 ? {kind:'calm' as const,from:'#22c55e',to:'#059669'}
    : {kind:'soon' as const,from:'#facc15',to:'#fb923c'}
}
