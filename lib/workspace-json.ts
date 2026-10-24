import { withWorkspaceFileLock } from './workspace-file-lock.ts'
import { readWorkspaceFileText } from './workspace-file-read.ts'

async function fileHandle(root: FileSystemDirectoryHandle, path: string, create = false) {
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) throw new Error('Ruta JSON inválida.')
  let dir = root
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create })
  return dir.getFileHandle(parts.at(-1)!, { create })
}
async function text(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  try { return await readWorkspaceFileText(await fileHandle(root, path)) }
  catch (error) { if ((error as Error).name === 'NotFoundError') return null; throw error }
}
async function put(root: FileSystemDirectoryHandle, path: string, raw: string) {
  const handle = await fileHandle(root, path, true), writer = await handle.createWritable()
  try { await writer.write(raw); await writer.close() }
  catch (error) { await writer.abort().catch(() => {}); throw error }
  if (await (await handle.getFile()).text() !== raw) throw new Error(`No se pudo verificar ${path}.`)
}
function parse(raw: string) { return JSON.parse(raw.replace(/^\uFEFF/, '')) }
async function recoveryPath(path: string, generation: 'current' | 'previous' | 'damaged') {
  // Mirroring a long cache path under the recovery folder exceeds Windows' path
  // limit even when the original file is perfectly readable.
  const key = path.length <= 120 ? path : `by-path/${await hashText(path)}.json`
  return `.json-recovery/${generation}/${key}`
}
async function hashText(raw: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(n => n.toString(16).padStart(2, '0')).join('')
}
async function archive(root: FileSystemDirectoryHandle, path: string, raw: string) {
  const hash = await hashText(raw)
  const target = path.length <= 120 ? `.json-recovery/damaged/${path}/${hash}.txt` : `.json-recovery/damaged/${await hashText(path)}/${hash}.txt`
  await put(root, target, raw)
}
async function remember(root: FileSystemDirectoryHandle, path: string, raw: string) {
  const backup = await recoveryPath(path, 'current'), previous = await text(root, backup)
  if (previous === raw) return
  if (previous?.trim()) {
    try { parse(previous); await put(root, await recoveryPath(path, 'previous'), previous) }
    catch (error) { if (!(error instanceof SyntaxError)) throw error }
  }
  await put(root, backup, raw)
}

/** Restore exact valid copies; never invent missing user content. */
export async function readWorkspaceJson<T>(root: FileSystemDirectoryHandle, path: string, fallback: T, readOnly = false): Promise<T> {
  return withWorkspaceFileLock(`write:${path}`, async () => {
    const raw = await text(root, path)
    if (raw?.trim()) {
      try {
        const value = parse(raw) as T
        if (!readOnly) await remember(root, path, raw)
        return value
      } catch (error) { if (!(error instanceof SyntaxError)) throw error }
    }
    // Missing files can be intentional deletions. Do not resurrect them.
    if (raw === null) return fallback
    for (const candidate of new Set([await recoveryPath(path, 'current'), `.json-recovery/current/${path}`, path.replace(/\.json$/, '.backup.json'), path + '.backup', await recoveryPath(path, 'previous'), `.json-recovery/previous/${path}`])) {
      if (candidate === path) continue
      const copy = await text(root, candidate)
      if (!copy?.trim()) continue
      let value: T
      try { value = parse(copy) as T } catch { continue }
      if (!readOnly) {
        await archive(root, path, raw)
        await put(root, path, copy)
        await remember(root, path, copy)
      }
      return value
    }
    if (!raw.trim()) return fallback
    throw new Error(`El archivo local «${path}» contiene JSON incompleto o inválido y todavía no tiene una copia válida para recuperarlo automáticamente.`)
  })
}

export async function writeWorkspaceJson(root: FileSystemDirectoryHandle, path: string, value: unknown) {
  const raw = JSON.stringify(value, null, 2)
  if (raw === undefined) throw new Error('No se puede guardar un valor JSON indefinido.')
  return withWorkspaceFileLock(`write:${path}`, async () => {
    const previous = await text(root, path)
    if (previous?.trim()) {
      try { parse(previous); await remember(root, path, previous) }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        await archive(root, path, previous)
      }
    }
    await put(root, path, raw)
    await remember(root, path, raw)
  })
}


/** Apply a repair only if the document still matches the version we inspected. */
export async function writeWorkspaceJsonIfUnchanged(root: FileSystemDirectoryHandle, path: string, expected: unknown, value: unknown): Promise<boolean> {
  return withWorkspaceFileLock(`write:${path}`, async () => {
    const previous = await text(root, path)
    if (!previous?.trim()) return false
    try { if (JSON.stringify(parse(previous)) !== JSON.stringify(expected)) return false } catch { return false }
    const raw = JSON.stringify(value, null, 2)
    if (raw === undefined) throw new Error('No se puede guardar un valor JSON indefinido.')
    await remember(root, path, previous)
    await put(root, path, raw)
    await remember(root, path, raw)
    return true
  })
}
