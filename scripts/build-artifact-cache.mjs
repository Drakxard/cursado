import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Vercel persists .next/cache between deployments. Cache only completed builds.
export async function cachedArtifact({ root, name, inputs, output, envFiles = [], env = {}, build }) {
  const viteEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_') || key === 'NODE_ENV').sort(([a], [b]) => a.localeCompare(b)))
  const hash = createHash('sha256').update(JSON.stringify({ version: 1, node: process.version, platform: process.platform, arch: process.arch, viteEnv, env }))
  async function visit(relative) {
    const absolute = path.join(root, relative)
    const info = await stat(absolute)
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) await visit(path.join(relative, entry))
    } else {
      hash.update(JSON.stringify(relative.split(path.sep).join('/')))
      const bytes = await readFile(absolute)
      hash.update(String(bytes.length) + ':').update(bytes)
    }
  }
  for (const input of inputs) await visit(input)
  for (const file of envFiles) {
    const bytes = await readFile(path.join(root, file)).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    hash.update(JSON.stringify([file, bytes?.toString('base64') ?? null]))
  }
  const fingerprint = hash.digest('hex')
  const cacheRoot = path.resolve(root, '.next/cache/build-artifacts')
  const cache = path.resolve(cacheRoot, name)
  if (path.dirname(cache) !== cacheRoot) throw new Error('Invalid artifact cache name')
  const target = path.resolve(root, output)
  if (!target.startsWith(path.resolve(root, 'public') + path.sep)) throw new Error('Invalid artifact output')
  const metadata = await readFile(path.join(cache, 'fingerprint'), 'utf8').catch(() => '')
  if (metadata === fingerprint) {
    // Keep an existing output intact if the cache is incomplete or damaged.
    try {
      await stat(path.join(cache, 'output/index.html'))
      await rm(target, { recursive: true, force: true })
      await cp(path.join(cache, 'output'), target, { recursive: true })
      console.log(`${name}: reutilizado desde caché`)
      return
    } catch { /* Rebuild when cached files cannot be restored. */ }
  }
  await build()
  await rm(cache, { recursive: true, force: true })
  await mkdir(cache, { recursive: true })
  await cp(target, path.join(cache, 'output'), { recursive: true })
  await writeFile(path.join(cache, 'fingerprint'), fingerprint)
}
