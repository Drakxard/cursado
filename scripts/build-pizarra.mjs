import { cachedArtifact } from './build-artifact-cache.mjs'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'pizarraproyecto-main')
const target = path.join(root, 'public', 'pizarra')
if (path.relative(root, path.resolve(target)) !== path.join('public', 'pizarra')) throw new Error('Unexpected board output directory')
await cachedArtifact({ root, name: 'pizarra',
  inputs: ['lib', 'types', 'tsconfig.json', 'package.json', 'package-lock.json', 'pizarraproyecto-main/src', 'pizarraproyecto-main/public', 'pizarraproyecto-main/scripts', 'pizarraproyecto-main/index.html', 'pizarraproyecto-main/plantuml.html', 'pizarraproyecto-main/vite.config.ts', 'pizarraproyecto-main/tsconfig.json', 'pizarraproyecto-main/tsconfig.app.json', 'pizarraproyecto-main/tsconfig.node.json', 'pizarraproyecto-main/package.json', 'pizarraproyecto-main/package-lock.json', 'scripts/build-pizarra.mjs', 'scripts/build-artifact-cache.mjs'],
  output: 'public/pizarra',
  env: {},
  envFiles: ['pizarraproyecto-main/.env', 'pizarraproyecto-main/.env.local', 'pizarraproyecto-main/.env.production', 'pizarraproyecto-main/.env.production.local'],
  build: async () => {
    const result = spawnSync(process.execPath, [path.join(source, 'node_modules/typescript/bin/tsc'), '-b'], { cwd: source, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
    const build = spawnSync(process.execPath, [path.join(source, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: source, stdio: 'inherit' })
    if (build.status !== 0) process.exit(build.status ?? 1)
    mkdirSync(target, { recursive: true })
    // Only generated files inside public/pizarra are replaced.
    for (const entry of readdirSync(target)) {
      const artifact = path.resolve(target, entry)
      if (path.dirname(artifact) !== path.resolve(target)) throw new Error('Unexpected generated artifact')
      rmSync(artifact, { recursive: true, force: true })
    }
    cpSync(path.join(source, 'dist'), target, { recursive: true })

  },
})
