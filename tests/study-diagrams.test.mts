import assert from 'node:assert/strict'
import test from 'node:test'
import { PlantUmlError, renderPlantUml } from '../lib/server/plantuml.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test('PlantUML sends plain source to the renderer and returns a validated PNG', async () => {
  const source = '@startuml\nAlice -> Bob: Hola\n@enduml'
  const fetcher = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://kroki.io/plantuml/png')
    assert.equal(init.method, 'POST'); assert.equal(init.body, source)
    assert.ok(init.signal)
    return new Response(png, { headers: { 'Content-Type': 'image/png' } })
  }) as typeof fetch
  assert.deepEqual(Buffer.from(await renderPlantUml(source, undefined, fetcher)), png)
})

test('invalid input never contacts the renderer', async () => {
  let calls = 0
  const fetcher = (async () => { calls++; throw new Error('unexpected fetch') }) as typeof fetch
  for (const input of [null, '', '  ', {}, 'a'.repeat(100_001)]) {
    await assert.rejects(() => renderPlantUml(input, undefined, fetcher), PlantUmlError)
  }
  assert.equal(calls, 0)
})

test('syntax errors are readable and invalid or excessive images cannot be imported', async () => {
  const response = (value: Response) => (async () => value) as typeof fetch
  await assert.rejects(() => renderPlantUml('broken', undefined, response(new Response('Syntax Error: line 3', { status: 400 }))), /Syntax Error: line 3/)
  await assert.rejects(() => renderPlantUml('code', undefined, response(new Response('unavailable', { status: 503 }))), (error: unknown) => error instanceof PlantUmlError && error.status === 502)
  await assert.rejects(() => renderPlantUml('code', undefined, response(new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }))), /imagen válida/)
  await assert.rejects(() => renderPlantUml('code', undefined, response(new Response('not a PNG', { headers: { 'Content-Type': 'image/png' } }))), /imagen inválida/)
  const oversized = Buffer.from(png); oversized.writeUInt32BE(10_000, 16)
  await assert.rejects(() => renderPlantUml('code', undefined, response(new Response(oversized, { headers: { 'Content-Type': 'image/png' } }))), /demasiado grande/)
})
