import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { mkdir, readFile, writeFile, cp, readdir, rm } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import * as sass from 'sass'
import { createRequire } from 'node:module'

const output = resolve(process.argv[2] || 'public/native-web')
const stage = resolve('.cache/native-web-build')
if (!stage.startsWith(resolve('.') + sep) || relative(resolve('.cache'),stage) !== 'native-web-build') throw new Error('Unexpected native web staging directory')
await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true })
await build({ entryPoints: { app: 'native-web/app.tsx', 'pizarra/board': 'native-web/board.jsx' }, outdir: stage, bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true,
  alias: { '@': resolve('.'), 'react': resolve('node_modules/react'), 'react-dom': resolve('node_modules/react-dom'), 'next/navigation': resolve('native-web/navigation.tsx'), 'next/link': resolve('native-web/navigation.tsx'), 'next/dynamic': resolve('native-web/dynamic.ts') },
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.svg': 'file', '.png': 'file' },
  plugins: [{ name: 'shared-web-assets', setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, args => ({ path: createRequire(resolve(args.resolveDir,'package.json')).resolve(args.path.slice(0,-4)), namespace:'asset-url' }))
    builder.onLoad({ filter: /.*/, namespace:'asset-url' }, async args => { const bytes = await readFile(args.path); const name = `asset-${createHash('sha256').update(bytes).digest('hex')}.mjs`; await writeFile(resolve(stage,name),bytes); return {contents:`export default ${JSON.stringify('/'+name)}`,loader:'js'} })
    builder.onResolve({ filter: /^\// }, args => args.kind === 'url-token' ? { path: args.path, external: true } : undefined)
    builder.onLoad({ filter: /\.scss$/ }, async args => ({ contents: (await sass.compileAsync(args.path, { silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions'] })).css, loader: 'css', resolveDir: resolve(args.path, '..') }))
    builder.onLoad({ filter: /\.jpg$/ }, async args => { const name = `image-${createHash('sha256').update(await readFile(args.path)).digest('hex')}.jpg`; await cp(args.path, resolve(stage,name)); return { contents: `export default {src:${JSON.stringify('/'+name)}}`, loader:'js' } })
  } }],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' },
  legalComments: 'eof',
})
const globals = await postcss([tailwind({ base: resolve('.') })]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })
await writeFile(resolve(stage, 'app.css'), globals.css + '\n' + await readFile(resolve(stage, 'app.css'), 'utf8') + '\n[data-workspace-write="true"]{display:none!important}[data-native-study-tabs="closed"] [data-study-workspace-tabs]>div{visibility:hidden!important;opacity:0!important;pointer-events:none!important}[data-native-study-tabs="open"] [data-study-workspace-tabs]>div{visibility:visible!important;opacity:1!important;transform:none!important;pointer-events:auto!important}')
await writeFile(resolve(stage, 'app.css'), (await readFile(resolve(stage,'app.css'),'utf8')) + '\n.native-library-controls{position:fixed;left:12px;bottom:12px;z-index:2000;display:flex;align-items:flex-end;gap:4px}.native-library-controls button,.native-library-controls summary{display:grid;place-items:center;width:36px;height:36px;background:var(--background,#fff);color:var(--foreground,#182235);border:1px solid #cbd5e1;border-radius:50%;box-shadow:0 2px 8px #0001;cursor:pointer;list-style:none}.native-library-controls summary::-webkit-details-marker{display:none}.native-library-controls details{position:relative}.native-library-controls details[open]{display:flex;flex-direction:column-reverse;gap:4px}')
await writeFile(resolve(stage,'pizarra/board.css'), (await readFile(resolve(stage,'pizarra/board.css'),'utf8')) + '\n[data-workspace-write="true"]{display:none!important}.toolbar{display:none!important}.sheet-static-layer,.board-graph-layer{pointer-events:none!important}.sheet-hover-controls,.board-video-resize,.math-dock,.math-panel,.device-storage-panel{display:none!important}')
await cp('native-web/index.html', resolve(stage, 'index.html'))
await writeFile(resolve(stage, 'pizarra/index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/pizarra/board.css"></head><body><div id="root"></div><script type="module" src="/pizarra/board.js"></script></body></html>')
for (const name of ['pdfjs', 'vendor', 'fonts', 'sintesis', 'icon.svg', 'pizarra-home.svg']) await cp(resolve('public', name), resolve(stage, name), { recursive: true, filter: path => !path.endsWith('.map') && !path.endsWith('compressed.tracemonkey-pldi-09.pdf') })
const files = []
async function visit(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = resolve(dir, entry.name); if (entry.isDirectory()) await visit(path); else { let bytes = await readFile(path); if (entry.name.endsWith('.css')) { const css=postcss.parse(bytes.toString()); css.walkAtRules('import',rule=>{if (/https?:/.test(rule.params)) rule.remove()}); bytes=Buffer.from(css.toString()); await writeFile(path,bytes) } files.push({ path: relative(stage, path).replaceAll('\\', '/'), size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') }) } } }
await visit(stage); files.sort((a,b) => a.path.localeCompare(b.path))
const revision = createHash('sha256').update(JSON.stringify(files)).digest('hex')
const manifest = { version: 1, bridgeVersion: 1, revision, files }
await mkdir(resolve(output, 'releases'), { recursive: true })
await cp(stage, resolve(output, 'releases', revision), { recursive: true })
await writeFile(resolve(output, 'current.json'), JSON.stringify(manifest))
console.log(`Native web ${revision}: ${files.length} files (${files.reduce((sum,file) => sum + file.size,0)} bytes)`)
