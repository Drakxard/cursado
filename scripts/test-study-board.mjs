import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url)), children = []
async function up(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok } catch { return false } }
async function service(url, entry, cwd, args) {
  if (await up(url)) return
  const child = spawn(process.execPath, [path.join(root, entry), ...args], { cwd: path.join(root, cwd), stdio: 'inherit', windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', VITE_WORKER_HOST: '127.0.0.1:8787' } })
  children.push(child)
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (await up(url)) return
    if (child.exitCode !== null) throw new Error(`No se pudo iniciar ${url}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`No respondió ${url}`)
}
try {
  await service('http://127.0.0.1:8787/health', 'pizarra-sync/packages/worker/node_modules/wrangler/bin/wrangler.js', 'pizarra-sync/packages/worker', ['dev'])
  await service('http://127.0.0.1:5173', 'pizarra-sync/packages/client-web/node_modules/vite/bin/vite.js', 'pizarra-sync/packages/client-web', [])
  const test = spawn(process.execPath, ['--test', 'tests/study-board.browser.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true })
  process.exitCode = await new Promise(resolve => test.on('exit', code => resolve(code ?? 1)))
} finally {
  for (const child of children.reverse()) {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
}
