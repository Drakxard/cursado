import assert from 'node:assert/strict'
import test from 'node:test'
import { generateSequence, decodeGeneratedSequence, generationSchema, SequenceValidationError } from '../lib/treap-demo/generation.mjs'
import { evaluationCases, assessSequence, reviewTeaching, sourceEvaluationCase, casePrompt } from '../lib/treap-demo/evaluation.mjs'
import { createAzure } from '@ai-sdk/azure'
import { zodSchema } from 'ai'

function fixture(item) {
  const step = operation => ({ title: 'Ejemplo', text: 'Ejemplo didáctico adicional.', badge: 'Paso', focus: [], operation })
  const operations = [{ type: 'observe' }, { type: 'insert', node: item.node }, ...item.rotations.map(type => ({ type, pivot: 'parent' })), { type: 'observe' }, { type: 'check' }]
  return { version: 1, catalog: item.catalog, initial: item.initial, steps: operations.map(step) }
}
function wire(sequence) {
  const tree = value => ({ root: value.root, nodes: Object.entries(value.children).map(([id, [left, right]]) => ({ id, left, right })) })
  return { ...sequence, initial: tree(sequence.initial), steps: sequence.steps.map(step => ({ ...step, operation: step.operation.type === 'show' ? { type: 'show', tree: tree(step.operation.tree) } : step.operation })) }
}
test('fixed pilot covers both rotation directions and an insertion needing none', () => {
  for (const item of evaluationCases) {
    const decoded = decodeGeneratedSequence(wire(fixture(item)))
    assert.equal(assessSequence(decoded, item).passed, true)
    const changed = structuredClone(decoded)
    changed.catalog[0].priority += 1000
    assert.throws(() => assessSequence(changed, item))
  }
})
test('source pilot validates a model-chosen example and keeps the source separate', () => {
  const sequence = fixture(evaluationCases[0])
  assert.equal(assessSequence(sequence, sourceEvaluationCase).sourceBased, true)
  const headingDisclosure = structuredClone(sequence)
  headingDisclosure.steps[0].title = 'Ejemplo didáctico adicional'
  headingDisclosure.steps[0].text = 'Los números elegidos son ilustrativos y no provienen del apunte.'
  assert.equal(assessSequence(headingDisclosure, sourceEvaluationCase).passed, true)
  const prompt = casePrompt(sourceEvaluationCase)
  assert.ok(prompt.includes(sourceEvaluationCase.sourcePage.transcription))
  assert.ok(!('catalog' in sourceEvaluationCase))
  for (const change of [
    input => { input.steps[0].text = 'Los números están en el apunte.' },
    input => { input.catalog.find(n => n.id === 'parent').priority = 95 },
    input => { input.steps.unshift({ ...input.steps[0], operation: { type: 'show', tree: input.initial } }) },
  ]) {
    const altered = structuredClone(sequence); change(altered)
    assert.throws(() => assessSequence(altered, sourceEvaluationCase))
  }
})
test('decoder rejects duplicate transport IDs and evaluator rejects show shortcuts', () => {
  const item = evaluationCases[0], sequence = fixture(item), input = wire(sequence)
  input.initial.nodes.push(input.initial.nodes[0])
  assert.throws(() => decodeGeneratedSequence(input), /duplicados/)
  sequence.steps.unshift({ ...sequence.steps[0], operation: { type: 'show', tree: item.initial } })
  assert.throws(() => assessSequence(sequence, item), /show/)
})
test('teaching indicators distinguish internal IDs, broad focus and missing traversal', () => {
  const item = evaluationCases[0], sequence = fixture(item)
  sequence.steps[0].focus = item.catalog.filter(n => n.id !== 'new').map(n => n.id)
  sequence.steps[1].text = "Insertar new junto a parent"
  const before = reviewTeaching(sequence, item)
  assert.equal(before.maxFocusedNodes, 4)
  assert.equal(before.routeCoveredBeforeInsertion, false)
  assert.deepEqual(before.internalIdMentions.map(m => m.id).sort(), ['new', 'parent'])
  sequence.steps[0].focus = []
  sequence.steps[1].text = 'Insertar la clave 30 a la derecha de 20'
  sequence.steps.splice(1, 0, { title: 'Recorrido', text: '30 < 40, vamos a la izquierda; 30 > 20, vamos a la derecha.', badge: 'Buscar', focus: ['root', 'parent'], operation: { type: 'observe' } })
  const after = reviewTeaching(sequence, item)
  assert.equal(after.maxFocusedNodes, 2)
  assert.equal(after.routeCoveredBeforeInsertion, true)
  assert.deepEqual(after.internalIdMentions, [])
  const immediateRoute = structuredClone(sequence)
  immediateRoute.steps.splice(0, 2,
    { ...sequence.steps[1], focus: ['root'] },
    { ...sequence.steps[1], focus: ['parent'] })
  assert.equal(reviewTeaching(immediateRoute, item).routeCoveredBeforeInsertion, true)
  const badWire = wire(sequence)
  badWire.steps[0].focus = ['root', 'parent', 'right']
  assert.throws(() => decodeGeneratedSequence(badWire))
})
test('provider schema uses fixed object fields and required properties', async () => {
  const schema = await zodSchema(generationSchema).jsonSchema
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (value.type === 'object') {
      assert.equal(value.additionalProperties, false)
      assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort())
    }
    assert.equal('prefixItems' in value, false)
    for (const child of Object.values(value)) if (child && typeof child === 'object') {
      if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(schema)
})
test('real Azure SDK sends strict structured output; no live request is made', async t => {
  let calls = 0
  const item = evaluationCases[0]
  let payload = wire(fixture(item))
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'gpt-5-mini')
    assert.equal(body.text.format.type, 'json_schema')
    assert.equal(body.text.format.strict, true)
    assert.equal(body.max_output_tokens, 6000)
    assert.equal(body.reasoning.effort, 'low')
    return Response.json({ id: 'resp-pilot', created_at: 1, model: 'gpt-5-mini', status: 'completed',
      output: [{ type: 'message', id: 'msg-pilot', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(payload), annotations: [] }] }],
      usage: { input_tokens: 30, output_tokens: 50, total_tokens: 80 } })
  })
  const model = createAzure({ apiKey: 'fake-test-key', baseURL: 'https://example.openai.azure.com/openai/v1' }).responses('gpt-5-mini')
  const generated = await generateSequence(model, 'Explicá el caso de prueba.')
  assert.equal(calls, 1)
  assert.equal(assessSequence(generated.sequence, item).passed, true)
  assert.equal(generated.usage.totalTokens, 80)
  payload = structuredClone(payload)
  payload.steps.at(-1).operation = { type: 'insert', node: item.node }
  await assert.rejects(generateSequence(model, 'Caso inválido de prueba.'), error => {
    assert.ok(error instanceof SequenceValidationError)
    assert.match(error.message, /ya está insertado/)
    assert.deepEqual(error.output, payload)
    assert.equal(error.usage.totalTokens, 80)
    return true
  })
  assert.equal(calls, 2) // One call per invocation; no automatic repair.
})
