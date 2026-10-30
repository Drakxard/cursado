import { mapBindingText, type SphereBinding } from './client/cooperation-files.ts'

/** Local mirror filenames differ; all members must join one canonical Yjs room. */
export async function cooperativeStudyRoomId(binding: SphereBinding, boardId: string) {
  const suffix = `-${binding.id.slice(0, 8)}`
  const canonicalId = mapBindingText(boardId, binding, false)
  const canonical = !binding.owner && canonicalId.endsWith(suffix) ? canonicalId.slice(0, -suffix.length) : canonicalId
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['cooperative-study-board', binding.id, canonical])))
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
  return `study-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
}
