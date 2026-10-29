import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'pizarra-sync')
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
