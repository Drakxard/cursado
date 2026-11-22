import { readdir, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

// Native clients cache releases on the device. The server only needs the release
// advertised by current.json; retaining every build duplicates all bundled assets.
export async function pruneNativeReleases(output, currentRevision) {
  if (!/^[a-f0-9]{64}$/.test(currentRevision)) throw new Error('Invalid native revision')
  const releases = resolve(output, 'releases')
  for (const entry of await readdir(releases, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name) || entry.name === currentRevision) continue
    const target = resolve(releases, entry.name)
    if (dirname(target) !== releases) throw new Error('Unexpected native release path')
    await rm(target, { recursive: true, force: true })
  }
}
