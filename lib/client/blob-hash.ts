import { Sha256 } from '@aws-crypto/sha256-js'

/** Fingerprint files without allocating another buffer the size of the file. */
export async function hashBlob(blob: Blob): Promise<string> {
  if (blob.size <= 64 * 1024) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const hash = new Sha256(), reader = blob.stream().getReader()
  let processed = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      hash.update(chunk.value)
      processed += chunk.value.byteLength
      if (processed >= 4 * 1024 * 1024) { processed = 0; await new Promise(resolve => setTimeout(resolve, 0)) }
    }
  } finally { reader.releaseLock() }
  return Array.from(await hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('')
}
