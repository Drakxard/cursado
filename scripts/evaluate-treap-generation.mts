import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import nextEnv from '@next/env'
import { azureExplanationConfig, azureExplanationModel } from '../lib/server/pdf-explanation-azure.ts'
import { generateSequence, SequenceValidationError, generationInstructions, generationRevision } from '../lib/treap-demo/generation.mjs'
import { evaluationCases, sourceEvaluationCase, casePrompt, assessSequence } from '../lib/treap-demo/evaluation.mjs'

const args = process.argv.slice(2)
const live = args.includes('--live')
const caseId = args.find(arg => arg.startsWith('--case='))?.slice(7)
if (args.some(arg => arg !== '--live' && !arg.startsWith('--case='))) throw new Error('Usá --live y opcionalmente --case=left|right|no-rotation|source-treaps.')
const cases = caseId === sourceEvaluationCase.id ? [sourceEvaluationCase] : evaluationCases.filter(item => !caseId || item.id === caseId)
if (!cases.length) throw new Error('Caso desconocido.')
if (!live) {
  console.log(JSON.stringify({ mode: 'offline-plan', requests: 0, cases: cases.map(item => ({ id: item.id, prompt: casePrompt(item) })), note: 'Agregá --live para realizar una llamada por caso, sin reintentos.' }, null, 2))
} else {
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} })
  const config = azureExplanationConfig()
  if (!config) throw new Error('Configurá gpt5mini y conexiongpt5mini en .env.local antes de usar --live.')
  const directory = `.cache/treap-evaluation/${Date.now()}`
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/instructions.txt`, generationInstructions)
  const results: Record<string, unknown>[] = []
  for (const item of cases) {
    const started = Date.now()
    let stage = 'provider'
    try {
      const prompt = casePrompt(item)
      await writeFile(`${directory}/${item.id}-prompt.txt`, prompt)
      const generated = await generateSequence(azureExplanationModel(config), prompt)
      stage = 'assessment'
      await writeFile(`${directory}/${item.id}.json`, JSON.stringify(generated.sequence, null, 2))
      const assessment = assessSequence(generated.sequence, item)
      stage = 'export'
      await promisify(execFile)(process.execPath, ['scripts/build-treap-demo.mjs', `${directory}/${item.id}.json`, `${directory}/${item.id}.html`])
      results.push({ id: item.id, ...assessment, elapsedMs: Date.now() - started, usage: generated.usage })
    } catch (error) {
      // Provider exceptions can contain URLs, headers or response bodies: never
      // persist or print the raw exception in this evaluator.
      if (error instanceof SequenceValidationError) await writeFile(`${directory}/${item.id}.invalid.json`, JSON.stringify(error.output, null, 2))
      results.push({ id: item.id, passed: false, stage, elapsedMs: Date.now() - started,
        ...(error instanceof SequenceValidationError ? { usage: error.usage } : {}),
        error: error instanceof Error ? stage === 'assessment' || error instanceof SequenceValidationError ? error.message : error.name : 'UnknownError' })
    }
  }
  const report = { mode: 'live', revision: generationRevision, requests: cases.length, results, note: 'Validación estructural; revisar HTML y pedagogía manualmente.' }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ directory, ...report }, null, 2))
  if (results.some(result => !result.passed)) process.exitCode = 1
}
