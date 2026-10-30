'use client'
import { getReadyWorkspaceHandle, loadWorkspaceHandle, queryWorkspacePermission } from './local-workspace-client'
import { readWorkspaceJson, writeWorkspaceJson } from './workspace-json'
import { withWorkspaceFileLock } from './workspace-file-lock'
import { writeVerified } from './subject-voice-images'
import { audioManifestPath, audioPrefix, validateAudioWorkspace, type AudioWorkspace, type StudyAudio } from './subject-audio-model'

async function root() {
  const handle = getReadyWorkspaceHandle() ?? await loadWorkspaceHandle()
  if (!handle || await queryWorkspacePermission(handle) !== 'granted') throw new Error('Autorizá la carpeta local de Estudio para guardar y leer audios.')
  return handle
}
export async function loadAudioWorkspace(subjectId: string): Promise<AudioWorkspace> {
  const value = await readWorkspaceJson(await root(), audioManifestPath(subjectId), { version: 1, subjectId, folders: [], audios: [] })
  return validateAudioWorkspace(value, subjectId)
}
export async function updateAudioWorkspace(subjectId: string, update: (workspace: AudioWorkspace) => void | Promise<void>) {
  return withWorkspaceFileLock(`manifest:${audioManifestPath(subjectId)}`, async () => {
    const workspace = await loadAudioWorkspace(subjectId)
    await update(workspace)
    validateAudioWorkspace(workspace, subjectId)
    await writeWorkspaceJson(await root(), audioManifestPath(subjectId), workspace)
    window.dispatchEvent(new CustomEvent('cursado-audios-changed', { detail: { subjectId } }))
    window.dispatchEvent(new Event('cursado-workspace-saved'))
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('cursado-study-audios')
      channel.postMessage({ subjectId }); channel.close()
    }
    return workspace
  })
}
export async function saveStudyAudio(subjectId: string, id: string, name: string, parentId: string | null, blob: Blob, duration: number, live: Pick<StudyAudio, 'transcript' | 'transcription' | 'transcriptionError'> = { transcript: '', transcription: 'none' }) {
  if (!name.trim() || !blob.size || !Number.isFinite(duration) || duration <= 0) throw new Error('Ingresá un nombre y grabá un audio válido.')
  return updateAudioWorkspace(subjectId, async workspace => {
    if (workspace.audios.some(audio => audio.id === id)) return // Retry after a completed disk write.
    const path = `${audioPrefix(subjectId)}${id}.wav`
    if (parentId !== null && !workspace.folders.some(folder => folder.id === parentId)) throw new Error('El conjunto de destino ya no existe.')
    await writeVerified(await root(), path, blob)
    workspace.audios.push({ id, name: name.trim(), parentId, path, duration, ...live })
  })
}
export async function readStudyAudio(subjectId: string, id: string) {
  const workspace = await loadAudioWorkspace(subjectId), audio = workspace.audios.find(item => item.id === id)
  if (!audio) throw new Error('El audio ya no existe.')
  const parts = audio.path.split('/'); let directory = await root()
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part)
  return (await directory.getFileHandle(parts.at(-1)!)).getFile()
}
