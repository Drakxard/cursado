import { withWorkspaceFileLock } from './workspace-file-lock.ts'

export type CalendarMarks = Record<string, string>
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date

export async function readCalendarMarks(root: FileSystemDirectoryHandle): Promise<CalendarMarks> {
  let text: string
  try {
    const directory = await root.getDirectoryHandle('progreso')
    text = await (await (await directory.getFileHandle('calendario-marcas.json')).getFile()).text()
  } catch (error) { if ((error as Error).name === 'NotFoundError') return {}; throw error }
  const value = JSON.parse(text)
  if (value.version !== 1 || !value.marks || typeof value.marks !== 'object' || Array.isArray(value.marks) ||
    Object.entries(value.marks).some(([date, name]) => !validDate(date) || typeof name !== 'string' || !name.trim() || name.length > 120)) throw new Error('Las marcas del calendario no tienen un formato válido.')
  return value.marks
}

export async function writeCalendarMark(root: FileSystemDirectoryHandle, date: string, name: string): Promise<CalendarMarks> {
  name = name.trim()
  if (!validDate(date) || !name || name.length > 120) throw new Error('Escribí un nombre de hasta 120 caracteres.')
  return withWorkspaceFileLock('calendar-marks', async () => {
    const marks = { ...await readCalendarMarks(root), [date]: name }
    const directory = await root.getDirectoryHandle('progreso', { create: true })
    const writer = await (await directory.getFileHandle('calendario-marcas.json', { create: true })).createWritable()
    try { await writer.write(JSON.stringify({ version: 1, marks })); await writer.close() }
    catch (error) { await writer.abort().catch(() => {}); throw error }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('cursado-workspace-saved'))
    return marks
  })
}
