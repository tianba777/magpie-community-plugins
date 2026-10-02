// Explicit, opt-in inference checks through a running Magpie gateway.
// Credentials belong in the environment; this script never reads Factory auth.
import { writeFile } from "node:fs/promises"
import { FactoryAuthPlugin, _internal } from "../packages/factory/index.mjs"

const base = process.env.MAGPIE_TEST_URL?.replace(/\/+$/, "")
const key = process.env.MAGPIE_TEST_KEY
const provider = process.env.MAGPIE_TEST_PROVIDER || "factory-plugin"
if (!base || !key) {
  throw new Error("Set MAGPIE_TEST_URL and MAGPIE_TEST_KEY for an isolated Magpie gateway")
}
if (!["http:", "https:"].includes(new URL(base).protocol)) throw new Error("Expected an HTTP(S) gateway")

const config = {}
const plugin = await FactoryAuthPlugin({ client: { auth: { set() { throw new Error("No auth writes in the gateway checker") } } } })
await plugin.config(config)
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
const catalogResponse = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(15_000) })
if (!catalogResponse.ok) throw new Error(`Magpie model catalog returned ${catalogResponse.status}`)
const catalog = await catalogResponse.json()
const listed = new Set((catalog.data ?? []).map((model) => model.id))
const textOf = (body) => {
  if (!body) return ""
  if (typeof body.output_text === "string") return body.output_text
  if (Array.isArray(body.output)) return body.output.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("")
  if (Array.isArray(body.content)) return body.content.map((item) => item.text ?? "").join("")
  const content = body.choices?.[0]?.message?.content
  return typeof content === "string" ? content : ""
}
const results = []
for (const [id, metadata] of Object.entries(config.provider.factory.models)) {
  const model = `${provider}/${id}`
  const api = metadata.provider.npm === "@ai-sdk/anthropic" ? "/v1/messages"
    : metadata.provider.npm === "@ai-sdk/openai" ? "/v1/responses" : "/v1/chat/completions"
  const request = { model, stream: false }
  if (api === "/v1/responses") {
    request.input = "Reply exactly OK."
    request.max_output_tokens = 128
    request.reasoning = { effort: Object.keys(metadata.variants)[0] }
  } else {
    request.messages = [{ role: "user", content: "Reply exactly OK." }]
    request.max_tokens = 128
  }
  const started = performance.now()
  let status = 0, response = null, transportError = null
  try {
    const res = await fetch(`${base}${api}`, { method: "POST", headers, body: JSON.stringify(request), signal: AbortSignal.timeout(30_000) })
    status = res.status
    try { response = await res.json() } catch { transportError = "Response was not JSON" }
  } catch (error) {
    transportError = error.name
  }
  const generated = textOf(response)
  const result = {
    model, pool: _internal.CORE.includes(id) ? "Droid Core" : "Standard", api,
    listed: listed.has(model), status,
    duration_ms: Math.round(performance.now() - started),
    usable: status >= 200 && status < 300 && generated.trim().length > 0,
    returned_model: response?.model ?? null,
    generated_characters: generated.length,
    error_type: response?.error?.type ?? transportError,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
const report = {
  timestamp: new Date().toISOString(), provider,
  route: "Magpie gateway -> installed Factory plugin -> Factory API",
  input: "Reply exactly OK.", max_output_tokens: 128, stream: false,
  model_count: results.length,
  listed_count: results.filter((r) => r.listed).length,
  usable_count: results.filter((r) => r.usable).length,
  results,
}
if (process.env.MAGPIE_TEST_RESULT) await writeFile(process.env.MAGPIE_TEST_RESULT, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ checked: report.model_count, usable: report.usable_count }))
if (report.usable_count !== report.model_count) process.exitCode = 1
