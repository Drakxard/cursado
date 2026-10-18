import { DEFAULT_EXPLANATION_INSTRUCTIONS } from "../lib/pdf-explanation.ts"
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { explanationStream } from "../lib/server/pdf-explanation-stream.ts"
import { DefaultChatTransport, readUIMessageStream } from "ai"
import { lessonHtml } from "../lib/pdf-explanation-lesson.ts"
import { structuredFixture } from "./helpers/explanation-lesson-fixture.mts"
import { STRUCTURED_EXPLANATION_INSTRUCTIONS } from "../lib/pdf-explanation-structured.ts"
import { gridGraphFixture } from "./helpers/explanation-graphs-fixture.mts"

function textModel(text: string, reason: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: { unified: reason, raw: undefined }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    } },
  ] as LanguageModelV4StreamPart[] }) }) })
}

test("graph JSON is delivered by Gateway and strict Azure, with one validation correction", async () => {
  const wire = { lesson: { ...gridGraphFixture, diapositivas: gridGraphFixture.diapositivas.map(s => ({ ...s,
    posiciones: Object.entries(s.posiciones).map(([id, position]) => ({ id, ...position })),
  })) } }
  for (const provider of ["gateway", "azure"] as const) {
    const valid = provider === "azure" ? wire : gridGraphFixture
    const invalid = structuredClone(valid)
    if ("lesson" in invalid) invalid.lesson.diapositivas[0].comentarios[0].anclado_a = "missing"
    else invalid.diapositivas[0].comentarios[0].anclado_a = "missing"
    const badModel = textModel(JSON.stringify(invalid)), goodModel = textModel(JSON.stringify(valid))
    let calls = 0
    const model = new MockLanguageModelV4({ doStream: async options => calls++ === 0 ? badModel.doStream(options) : goodModel.doStream(options) })
    const chunks = await parts(explanationStream(model, "Explicá la rotación", "Árbol del apunte", { provider }))
    assert.equal(calls, 2)
    assert.ok(chunks.some(part => part.data?.stage === "error-validacion-leccion"))
    assert.ok(chunks.find(part => part.type === "data-explanation")?.data.html.includes('id="graph-data"'))
  }
})
async function parts(response: Response) {
  return (await response.text()).split("\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)))
}

test("Azure requests strict structured output and preserves region, transcription and preferences", async () => {
  const model = textModel(JSON.stringify(structuredFixture))
  const image = "data:image/png;base64,aGVsbG8="
  const chunks = await parts(explanationStream(model, "Explicá el árbol", "Texto de la página", { provider: "azure", image, instructions: "Con las letras del apunte" }))
  assert.ok(chunks.some(part => part.type === "data-explanation"))
  const request = model.doStreamCalls[0]
  assert.equal(request.prompt[0].role, "system")
  assert.ok(String(request.prompt[0].content).startsWith(STRUCTURED_EXPLANATION_INSTRUCTIONS))
  assert.ok(String(request.prompt[0].content).includes("pantilla1_grafos"))
  const content = request.prompt.find(message => message.role === "user")!.content
  assert.ok(Array.isArray(content))
  assert.equal(content[0].type, "text")
  assert.equal(content[0].text, "Explicá el árbol\n\nTexto de la página\n\nCon las letras del apunte")
  assert.equal(content[1].type, "file")
  assert.equal(request.responseFormat?.type, "json")
  assert.ok(request.responseFormat?.type === "json" && request.responseFormat.schema)
  assert.equal(request.providerOptions?.openai.strictJsonSchema, true)
  assert.equal(request.maxOutputTokens, 12000)
  assert.equal(model.doStreamCalls.length, 1)
})

test("real UI SDK receives reusable lesson HTML with usage and elapsed diagnostics", async () => {
  const model = textModel(JSON.stringify(structuredFixture))
  const response = explanationStream(model, "Pedido", "Página")
  const transport = new DefaultChatTransport({ fetch: async () => response })
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "test", messageId: undefined, messages: [] })
  let delivered = "", usage: unknown, elapsed: unknown
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    for (const part of message.parts) {
      if (part.type === "data-explanation") delivered = (part.data as { html: string }).html
      if (part.type === "data-explanation-debug" && (part.data as { stage: string }).stage === "validacion-leccion") {
        usage = (part.data as { usage: unknown }).usage; elapsed = (part.data as { elapsedMs: unknown }).elapsedMs
      }
    }
  }
  assert.ok(delivered.includes('id="verlo-lesson"'))
  assert.ok(delivered.includes("connect-src 'none'"))
  assert.ok(usage)
  assert.equal(typeof elapsed, "number")
})

test("Gateway corrects invalid JSON exactly once and never renders generated HTML", async () => {
  const invalid = textModel("<html><body>Do not render</body></html>")
  const valid = textModel(JSON.stringify(structuredFixture))
  let calls = 0
  const model = new MockLanguageModelV4({ doStream: async options => {
    return calls++ === 0 ? invalid.doStream(options) : valid.doStream(options)
  } })
  const chunks = await parts(explanationStream(model, "Pedido", "Página", { maxOutputTokens: 8192, fallbackModels: ["allowed-model"] }))
  assert.equal(calls, 2)
  assert.ok(chunks.some(part => part.type === "data-explanation"))
  assert.ok(chunks.some(part => part.data?.stage === "error-validacion-leccion"))
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 8192)
  assert.deepEqual(model.doStreamCalls[0].providerOptions?.gateway, { models: ["allowed-model"] })
  const repeated = textModel("invalid")
  const failure = await parts(explanationStream(repeated, "Pedido", "Página"))
  assert.equal(repeated.doStreamCalls.length, 2)
  assert.ok(failure.some(part => part.type === "error"))
  assert.ok(!failure.some(part => part.type === "data-explanation" || part.type === "finish"))
})

test("truncated structured output reports its limit with diagnostics after a single correction", async () => {
  const model = textModel('{"version":2', "length")
  const chunks = await parts(explanationStream(model, "Pedido", "Página"))
  assert.equal(model.doStreamCalls.length, 2)
  assert.ok(chunks.some(part => part.type === "error" && part.errorText.includes("agotó su límite")))
  assert.ok(chunks.some(part => part.data?.text === '{"version":2'))
})

test("Azure can correct a structurally invalid answer once without switching formats", async () => {
  const invalid = textModel('{"version":2,"title":"Missing steps"}')
  const valid = textModel(JSON.stringify(structuredFixture))
  let calls = 0
  const model = new MockLanguageModelV4({ doStream: async options => calls++ === 0 ? invalid.doStream(options) : valid.doStream(options) })
  const chunks = await parts(explanationStream(model, "Pedido", "Página", { provider: "azure" }))
  assert.equal(calls, 2)
  assert.ok(chunks.some(part => part.type === "data-explanation"))
  assert.ok(model.doStreamCalls.every(call => call.responseFormat?.type === "json"))
})

test("provider errors are not retried and diagnostics never expose credentials", async () => {
  for (const statusCode of [403, 429, 503]) {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "error", error: Object.assign(new Error("secret-key"), { statusCode, name: "APICallError", generationId: "generation-test" }) },
    ] as LanguageModelV4StreamPart[] }) }) })
    const chunks = await parts(explanationStream(model, "Pedido", "Página", { provider: "azure" }))
    assert.equal(model.doStreamCalls.length, 1)
    assert.equal(chunks.find(part => part.data?.stage === "error-proveedor").data.diagnostics.status, statusCode)
    assert.ok(!JSON.stringify(chunks).includes("secret-key"))
    assert.ok(!chunks.some(part => part.type === "finish" || part.type === "data-explanation"))
  }
})
test("previously generated lesson documents remain readable, including the reported longer Azure response", () => {
  const lesson = JSON.parse(readFileSync(new URL("./fixtures/pdf-explanation-azure-long-steps.json", import.meta.url), "utf8"))
  const legacyHtml = lessonHtml(lesson)
  const data = JSON.parse(legacyHtml.match(/const lesson=(.*?);let index/)![1])
  assert.deepEqual(data, lesson)
  assert.throws(() => lessonHtml({ title: "Incomplete", steps: [] }))
  assert.ok(!lessonHtml({ ...lesson, title: '</script><script>alert("injected")</script>' }).includes('<script>alert("injected")'))
})
