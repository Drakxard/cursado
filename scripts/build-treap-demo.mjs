import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { compileSequence } from '../lib/treap-demo/sequence.mjs'

const [input = 'lib/treap-demo/example.json', output = 'public/demos/treap-d3.html', ...extra] = process.argv.slice(2)
if (extra.length) throw new Error('Uso: node scripts/build-treap-demo.mjs [entrada.json] [salida.html]')
const lesson = JSON.parse(await readFile(input, 'utf8'))
compileSequence(lesson) // Validate before writing anything.

const result = await build({ entryPoints: ['lib/treap-demo/player.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'inline' })
const template = await readFile('lib/treap-demo/template.html', 'utf8')
const payload = JSON.stringify(lesson).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const html = template.replace('<script>/* PLAYER */</script>', () => `<script id="treap-lesson" type="application/json">${payload}</script><script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, html)
console.log(`HTML autónomo: ${output}`)
