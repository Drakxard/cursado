import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

function files(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name)
    return entry.isDirectory() ? files(filename) : [filename]
  })
}
const reports = files('pizarra-sync/navigation-results').filter(file => /navigation-[\da-f]+\.json$/.test(file)).map(file => JSON.parse(readFileSync(file, 'utf8'))).filter(value => value.report)
const ms = value => `${value.toFixed(1)} ms`
const lines = ['## Navegacion de la pizarra (bundle de produccion)', '',
  '| Tema | Hover (30 consultas) | Notas reconstruidas al editar una | Nodos reordenados | Edicion + siguiente cuadro | Cuadro p95 | Pausa al terminar gesto |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
for (const { theme, report } of reports) lines.push(`| ${theme} | ${ms(report.hoverMs)} | ${report.changed.length} | ${report.moved} | ${ms(report.editMs)} | ${ms(report.frames.p95)} | ${ms(report.settleMs)} |`)
lines.push('', 'Los tiempos son mediciones del runner, no una garantia de FPS. Las pruebas fallan si una edicion reconstruye notas ajenas o mueve nodos sin cambiar su orden. Los JSON, perfiles CPU y trazas de fallos se conservan como artefactos.', '')
const summary = lines.join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
