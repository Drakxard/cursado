import { cachedArtifact } from './build-artifact-cache.mjs'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'pizarra-sync')
await cachedArtifact({ root, name: 'study-board',
  inputs: ['lib', 'types', 'tsconfig.json', 'package.json', 'package-lock.json', 'components/study-youtube-player.tsx', 'pizarraproyecto-main/src', 'pizarra-sync/packages/client-web/src', 'pizarra-sync/packages/client-web/public', 'pizarra-sync/packages/client-web/index.html', 'pizarra-sync/packages/client-web/vite.config.ts', 'pizarra-sync/packages/client-web/package.json', 'pizarra-sync/packages/shared/src', 'pizarra-sync/packages/shared/package.json', 'pizarra-sync/tsconfig.base.json', 'pizarra-sync/packages/client-web/tsconfig.json', 'pizarra-sync/packages/shared/tsconfig.json', 'pizarra-sync/package.json', 'pizarra-sync/pnpm-lock.yaml', 'pizarra-sync/pnpm-workspace.yaml', 'scripts/build-study-board.mjs', 'scripts/build-artifact-cache.mjs'],
  output: 'public/study-board',
  env: { worker: process.env.STUDY_BOARD_WORKER_HOST || 'pizarra-komuboard.dariorafael2005.workers.dev' },
  envFiles: ['pizarra-sync/packages/client-web/.env', 'pizarra-sync/packages/client-web/.env.local', 'pizarra-sync/packages/client-web/.env.production', 'pizarra-sync/packages/client-web/.env.production.local'],
  build: async () => {
    const vite = path.join(source, 'packages/client-web/node_modules/vite/bin/vite.js')
    if (!existsSync(vite)) {
      // Vercel builds with NODE_ENV=production; Vite and the build tools are devDependencies.
      const install = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'pnpm@9.15.0', 'install', '--frozen-lockfile', '--prod=false'], { cwd: source, stdio: 'inherit', shell: process.platform === 'win32' })
      if (install.status !== 0) process.exit(install.status ?? 1)
    }
    const result = spawnSync(process.execPath, [vite, 'build', '--base=/study-board/'], {
      cwd: path.join(source, 'packages/client-web'), stdio: 'inherit',
      env: { ...process.env, VITE_WORKER_HOST: process.env.STUDY_BOARD_WORKER_HOST || 'pizarra-komuboard.dariorafael2005.workers.dev' },
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
    const target = path.resolve(root, 'public/study-board')
    if (path.relative(root, target) !== path.join('public', 'study-board')) throw new Error('Unexpected study board output')
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(path.join(source, 'packages/client-web/dist'), target, { recursive: true })

  },
})
