import { readdir, rm, stat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function stripPublicSourceMaps(directory) {
  const root = resolve(directory)
  let removedBytes = 0
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile() && entry.name.endsWith('.map')) {
        if (relative(root, file).startsWith('..')) throw new Error('Unexpected static file path')
        removedBytes += (await stat(file)).size
        await rm(file)
      }
    }
  }
  await visit(root)
  return removedBytes
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const removed = await stripPublicSourceMaps('public')
  console.log(`Vercel: excluded ${removed} bytes of browser debugging maps`)
}
