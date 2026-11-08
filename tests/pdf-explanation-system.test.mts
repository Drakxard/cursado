import assert from "node:assert/strict"
import test from "node:test"
import { explanationSystemConfig, COMMON_EXPLANATION_INSTRUCTIONS } from "../lib/server/pdf-explanation-system.ts"
import { composeExplanationSystem } from "../lib/pdf-explanation-system.ts"
import { DEFAULT_EXPLANATION_INSTRUCTIONS } from "../lib/pdf-explanation.ts"
import { resolveGraphPresentation } from "../lib/pdf-explanation-graphs.ts"
import { decodeAzureExplanation } from "../lib/pdf-explanation-formats.ts"
import { azureExplanationFormatSchema } from '../lib/pdf-explanation-formats.ts'

test('math and prog use different teaching prompts and honor the requested direction', async () => {
  const math = (await explanationSystemConfig('azure', 'math', 'vertical')).systemPromptBase
  const prog = (await explanationSystemConfig('azure', 'prog', 'horizontal')).systemPromptBase
  assert.match(math, /ESPECIALIDAD MATH/)
  assert.match(math, /LaTeX delimitado/)
  assert.match(math, /ORIENTACIÓN VERTICAL/)
  assert.match(prog, /ESPECIALIDAD PROG/)
  assert.match(prog, /ORIENTACIÓN HORIZONTAL/)
  assert.match(math, /exclusivamente pantilla1_grafos/)
})

test("system instructions request only maps and provide valid examples for each provider", async () => {
  for (const provider of ["azure", "gateway"] as const) {
    const config = await explanationSystemConfig(provider)
    const prompt = config.systemPromptBase
    assert.ok(prompt.startsWith(COMMON_EXPLANATION_INSTRUCTIONS))
    assert.ok(prompt.includes("Nunca mezcles campos"))
    const graphJson = prompt.split("EJEMPLO COMPLETO DE pantilla1_grafos (formato de este proveedor; adaptá contenido y cantidad de pasos al apunte):\n\n")[1].split("\n\n")[0]
    assert.ok(!prompt.includes('EJEMPLO DE version 2:'))
    const decode = (json: string) => provider === "azure" ? decodeAzureExplanation(JSON.parse(json)) : JSON.parse(json)
    const graph = resolveGraphPresentation(decode(graphJson))
    const processJson = prompt.split('EJEMPLO GENERAL DE PROCESO (datos visibles, flechas y cambio de estado; adaptar al tema):\n\n')[1].split('\n\n')[0]
    const process = resolveGraphPresentation(decode(processJson))
    assert.equal(process.diapositivas[1].posiciones.proceso.datos![0].valor, 'en curso')
    assert.equal(process.diapositivas[0].aristas[0].dirigida, true)
    if (provider === 'azure') {
      assert.ok(azureExplanationFormatSchema.safeParse(JSON.parse(graphJson)).success)
      assert.ok(azureExplanationFormatSchema.safeParse(JSON.parse(processJson)).success)
    }
    assert.equal(graph.diapositivas.length, 5)
    assert.ok(graph.diapositivas.every(slide => slide.titulo && slide.objetivo))
    assert.deepEqual(graph.diapositivas[0].aristas, graph.diapositivas[1].aristas, 'prepare the movement before changing topology')
    assert.equal(graph.diapositivas[2].aristas[1].desde, "D")
    assert.equal(graph.diapositivas[2].aristas[1].hacia, "C")
    if (provider === "azure") {
      assert.ok(config.outputSchema)
      const example = JSON.parse(graphJson)
      assert.ok(Array.isArray(example.lesson.diapositivas[0].posiciones))
    } else {
      assert.equal(config.outputSchema, null)
      assert.ok(prompt.includes("JSON Schema:"))
    }
    assert.ok(composeExplanationSystem(prompt).endsWith(DEFAULT_EXPLANATION_INSTRUCTIONS))
    assert.ok(composeExplanationSystem(prompt, "  Usá las etiquetas originales  ").endsWith("Usá las etiquetas originales"))
  }
})
