import { build } from 'esbuild'
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const target = resolve(process.argv[2] || 'public/library-reader')
await mkdir(target, { recursive: true })
for (const file of ['index.html', 'library.js', 'library.css']) await copyFile(resolve('public/library', file), resolve(target, file))
const globals = await readFile('app/globals.css', 'utf8')
const themes = [...globals.matchAll(/(?::root,\s*)?\[data-theme='[^']+'\]\s*\{[^}]*\}/g)].map(match => match[0]).join('\n')
await writeFile(resolve(target, 'library-theme.css'), themes)
for (const file of ['icon.svg', 'pizarra-home.svg']) await copyFile(resolve('public', file), resolve(target, file))
await build({ entryPoints: ['pizarraproyecto-main/src/libraryReader.tsx'], outfile: resolve(target, 'board-reader.js'), bundle: true, jsx: 'automatic', format: 'iife', globalName: 'CursadoBoardReader', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof' })
// Package the actual Cursado PDF.js HTML, toolbar, CSS, locale and search reader.
await cp(resolve('public/pdfjs'), resolve(target, 'pdfjs'), { recursive: true, filter: source => !source.endsWith('.map') && !source.endsWith('compressed.tracemonkey-pldi-09.pdf') })
await mkdir(resolve(target, 'vendor'), { recursive: true })
await copyFile(resolve('public/vendor/pdf-lib.min.js'), resolve(target, 'vendor/pdf-lib.min.js'))
