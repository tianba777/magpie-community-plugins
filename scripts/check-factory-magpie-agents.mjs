// Opt-in gateway checks with representative prompts, not full agent clients.
// The script uses only a Magpie caller key and never reads Factory credentials.
import { writeFile } from "node:fs/promises"

const base = process.env.MAGPIE_TEST_URL?.replace(/\/+$/, "")
const key = process.env.MAGPIE_TEST_KEY
const provider = process.env.MAGPIE_TEST_PROVIDER || "factory"
if (!base || !key) throw new Error("Set MAGPIE_TEST_URL and MAGPIE_TEST_KEY")
if (!["http:", "https:"].includes(new URL(base).protocol)) throw new Error("Expected an HTTP(S) gateway")
const agents = [
  ["Hermes", "You are Hermes, an automation agent."],
  ["Claude Code", "You are Claude Code, a coding assistant."],
  ["WorkflowAgent", "You are WorkflowAgent, a custom multi-agent worker."],
]
const routes = [
  ["/v1/messages", "claude-haiku-4-5-20251001", "anthropic"],
  ["/v1/responses", "gpt-6.1-sol", "responses"],
  ["/v1/chat/completions", "deepseek-v4.1-flash", "chat"],
]
const textOf = (body) => {
  if (typeof body?.output_text === "string") return body.output_text
  if (Array.isArray(body?.output)) return body.output.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("")
  if (Array.isArray(body?.content)) return body.content.map((item) => item.text ?? "").join("")
  return typeof body?.choices?.[0]?.message?.content === "string" ? body.choices[0].message.content : ""
}
const results = []
for (const [agent, identity] of agents) {
  for (const [api, id, kind] of routes) {
    const expected = "magpie-agent-" + agent.replaceAll(" ", "-")
    const system = identity + " Follow the user's task and preserve quoted text."
    const prompt = "Reply exactly with this marker, without quotes or other text: " + expected
    const body = { model: `${provider}/${id}`, stream: false }
    if (kind === "anthropic") Object.assign(body, { system, messages: [{ role: "user", content: prompt }], max_tokens: 128 })
    else if (kind === "responses") Object.assign(body, { instructions: system, input: prompt, max_output_tokens: 128, reasoning: { effort: "low" } })
    else Object.assign(body, {
      messages: [{ role: "system", content: [{ type: "text", text: system }] },
        { role: "developer", content: "This is a short gateway compatibility check." },
        { role: "user", content: prompt }], max_tokens: 128,
    })
    const started = performance.now()
    let status = 0, response = null, errorType = null
    try {
      const res = await fetch(base + api, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
      status = res.status
      try { response = await res.json() } catch { errorType = "non_json_response" }
    } catch (error) { errorType = error.name }
    const generated = textOf(response)
    const result = { agent_prompt: agent, model: body.model, api, status,
      usable: status >= 200 && status < 300 && generated.trim().length > 0,
      exact_marker: generated.trim() === expected,
      returned_model: response?.model ?? null, generated_text: generated.slice(0, 160),
      duration_ms: Math.round(performance.now() - started), error_type: response?.error?.type ?? errorType }
    results.push(result)
    console.log(JSON.stringify(result))
  }
}
const report = { timestamp: new Date().toISOString(), provider,
  scope: "Representative prompts across three native gateway APIs; full agent clients are not tested.",
  checked: results.length, usable: results.filter((r) => r.usable).length,
  exact_markers: results.filter((r) => r.exact_marker).length, results }
if (process.env.MAGPIE_TEST_AGENTS_RESULT) await writeFile(process.env.MAGPIE_TEST_AGENTS_RESULT, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ scope: "representative_agent_prompts", checked: report.checked, usable: report.usable, exact_markers: report.exact_markers }))
if (report.checked !== 9 || report.usable !== 9 || report.exact_markers !== 9) process.exitCode = 1
