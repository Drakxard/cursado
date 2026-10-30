export type AudioFolder = { id: string; name: string; parentId: string | null }
export type StudyAudio = {
  id: string; name: string; parentId: string | null; path: string; duration: number
  transcript: string; transcription: 'pending' | 'processing' | 'completed' | 'error' | 'none' | 'unavailable' | 'partial'; transcriptionError?: string
}
export type AudioWorkspace = { version: 1; subjectId: string; folders: AudioFolder[]; audios: StudyAudio[] }
export const audioManifestPath = (subjectId: string) => `manifests/subject-voice/${encodeURIComponent(subjectId).replace(/\./g, '%2E')}/audios.json`
export const audioPrefix = (subjectId: string) => `subject-voice/audio/${encodeURIComponent(subjectId).replace(/\./g, '%2E')}/`
export function validateAudioWorkspace(value: unknown, subjectId: string): AudioWorkspace {
  const w = value as AudioWorkspace
  if (!w || w.version !== 1 || w.subjectId !== subjectId || !Array.isArray(w.folders) || !Array.isArray(w.audios)) throw new Error('El archivo de audios no es válido.')
  const ids = new Set<string>()
  for (const item of [...w.folders, ...w.audios]) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || (item.parentId !== null && typeof item.parentId !== 'string')) throw new Error('Elemento de audio inválido.')
    ids.add(item.id)
  }
  for (const item of [...w.folders, ...w.audios]) assertAudioDestination(w, item.id, item.parentId)
  for (const audio of w.audios) {
    const filename = typeof audio.path === 'string' && audio.path.startsWith(audioPrefix(subjectId)) ? audio.path.slice(audioPrefix(subjectId).length) : ''
    if (!filename || /[/\\]/.test(filename) || filename === '.' || filename === '..' || !Number.isFinite(audio.duration) || audio.duration <= 0 || typeof audio.transcript !== 'string' || !['pending','processing','completed','error','none','unavailable','partial'].includes(audio.transcription)) throw new Error('Archivo de audio inválido.')
  }
  return w
}
export function assertAudioDestination(w: AudioWorkspace, itemId: string, parentId: string | null) {
  const seen = new Set([itemId])
  while (parentId !== null) {
    if (seen.has(parentId)) throw new Error('No podés mover un conjunto dentro de sí mismo ni de sus descendientes.')
    seen.add(parentId)
    const folder = w.folders.find(item => item.id === parentId)
    if (!folder) throw new Error('El conjunto de destino ya no existe.')
    parentId = folder.parentId
  }
}
export function moveAudioItem(w: AudioWorkspace, itemId: string, parentId: string | null) {
  const item = [...w.folders, ...w.audios].find(item => item.id === itemId)
  if (!item) throw new Error('El elemento ya no existe.')
  assertAudioDestination(w, itemId, parentId)
  item.parentId = parentId
}
export function groupAudioPair(w: AudioWorkspace, first: string, second: string, name: string) {
  if (first === second || !name.trim()) throw new Error('Elegí dos audios y un nombre para el conjunto.')
  const a = w.audios.find(item => item.id === first), b = w.audios.find(item => item.id === second)
  if (!a || !b) throw new Error('Los audios ya no están disponibles.')
  const folder = { id: crypto.randomUUID(), name: name.trim(), parentId: b.parentId }
  w.folders.push(folder); a.parentId = folder.id; b.parentId = folder.id
}
