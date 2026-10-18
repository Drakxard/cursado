import assert from "node:assert/strict"
import test from "node:test"
import { generateText, Output } from "ai"
import { structuredLessonSchema } from "../lib/pdf-explanation-structured.ts"
import { structuredFixture } from "./helpers/explanation-lesson-fixture.mts"
import { azureExplanationConfig, azureExplanationModel } from "../lib/server/pdf-explanation-azure.ts"
import { normalizeInscreenUserConfig } from "../lib/inscreen-user-config.ts"
import { explanationFailure } from "../lib/pdf-explanation-errors.ts"

test("Azure Responses sends strict JSON Schema on the wire using the real provider", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    assert.equal(body.text.format.type, "json_schema")
    assert.equal(body.text.format.strict, true)
    assert.equal(body.text.format.schema.additionalProperties, false)
    assert.deepEqual(body.text.format.schema.required, ["version", "title", "warnings", "steps"])
    return Response.json({ id: "resp-lesson", created_at: 1, model: "gpt-5-mini", status: "completed",
      output: [{ type: "message", id: "msg-lesson", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(structuredFixture), annotations: [] }] }],
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } })
  })
  const config = azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.openai.azure.com" })!
  const result = await generateText({ model: azureExplanationModel(config), prompt: "Explicalo", output: Output.object({ schema: structuredLessonSchema }), maxRetries: 0 })
  assert.deepEqual(result.output, structuredFixture)
})

test("Azure configuration accepts the saved project endpoint and resource endpoints", () => {
  assert.equal(azureExplanationConfig({}), null)
  const project = azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.services.ai.azure.com/api/projects/study" })!
  assert.equal(project.baseURL, "https://example.services.ai.azure.com/api/projects/study/openai/v1")
  assert.equal(project.deployment, "gpt-5-mini")
  assert.equal(azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.openai.azure.com/openai/v1/", AZURE_OPENAI_DEPLOYMENT: "my-mini" })!.deployment, "my-mini")
  assert.throws(() => azureExplanationConfig({ gpt5mini: "test-key" }), /conexiongpt5mini/)
  assert.throws(() => azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://unrelated.example" }), /Azure/)
  assert.throws(() => azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.openai.azure.com/?key=test-key" }), /sin claves/)
})

test("real Azure SDK uses the project Responses endpoint, secret header and deployment name", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++
    assert.equal(String(url), "https://example.services.ai.azure.com/api/projects/study/openai/v1/responses")
    assert.equal(new Headers(init.headers).get("api-key"), "test-key")
    assert.ok(!String(url).includes("test-key"))
    const body = JSON.parse(init.body as string)
    assert.equal(body.model, "my-mini")
    assert.deepEqual(body.reasoning, { effort: "low" })
    assert.equal(body.max_output_tokens, 12_000)
    return Response.json({ id: "resp-test", created_at: 1, model: "gpt-5-mini", status: "completed",
      output: [{ type: "message", id: "msg-test", role: "assistant", content: [{ type: "output_text", text: "Listo", annotations: [] }] }],
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } })
  })
  const config = azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.services.ai.azure.com/api/projects/study", AZURE_OPENAI_DEPLOYMENT: "my-mini" })!
  const result = await generateText({ model: azureExplanationModel(config), prompt: "Explicalo", reasoning: "low", providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: null } }, maxOutputTokens: 12_000, maxRetries: 0 })
  assert.equal(result.text, "Listo")
  assert.equal(calls, 1)
  assert.match(explanationFailure({ statusCode: 404 }, "azure").message, /AZURE_OPENAI_DEPLOYMENT/)
  assert.match(explanationFailure({ statusCode: 429 }, "azure").message, /cuota/)
})


test("the full Responses endpoint from Azure is accepted for saved credentials and runtime requests", async t => {
  const endpoint = "https://modelo-resource.services.ai.azure.com/openai/v1/responses"
  for (const suffix of ["", "/"]) {
    const saved = normalizeInscreenUserConfig({ gpt5mini: "test-key", conexiongpt5mini: endpoint + suffix })
    assert.equal(saved.conexiongpt5mini, "https://modelo-resource.services.ai.azure.com/openai/v1")
    assert.equal(azureExplanationConfig({gpt5mini:"test-key",conexiongpt5mini:endpoint + suffix})!.baseURL, saved.conexiongpt5mini)
  }
  const project = "https://example.services.ai.azure.com/api/projects/study/openai/v1/responses"
  assert.equal(azureExplanationConfig({gpt5mini:"test-key",conexiongpt5mini:project})!.baseURL, project.replace(/\/responses$/, ""))
  for (const invalid of [endpoint + "?api-key=secret", endpoint + "#fragment", "https://unrelated.example/openai/v1/responses", "https://example.services.ai.azure.com.evil.test/openai/v1/responses"]) {
    assert.throws(() => normalizeInscreenUserConfig({gpt5mini:"key",conexiongpt5mini:invalid}))
  }
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(String(url), endpoint)
    return Response.json({ id:"resp-test",created_at:1,model:"gpt-5-mini",status:"completed",output:[{type:"message",id:"msg-test",role:"assistant",content:[{type:"output_text",text:"Listo",annotations:[]}]}],usage:{input_tokens:5,output_tokens:1,total_tokens:6} })
  })
  const config = azureExplanationConfig({gpt5mini:"test-key",conexiongpt5mini:endpoint})!
  assert.equal((await generateText({model:azureExplanationModel(config),prompt:"Hola",maxRetries:0})).text, "Listo")
})
