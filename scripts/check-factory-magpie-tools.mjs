// Opt-in native API/SSE checks through Magpie. Credentials come only from env.
import { writeFile } from "node:fs/promises"

const base = process.env.MAGPIE_TEST_URL?.replace(/\/+$/, "")
const key = process.env.MAGPIE_TEST_KEY
const provider = process.env.MAGPIE_TEST_PROVIDER || "factory-plugin"
if (!base || !key) throw new Error("Set MAGPIE_TEST_URL and MAGPIE_TEST_KEY")
let endpoint
try { endpoint = new URL(base) } catch { throw new Error("Invalid Magpie gateway URL") }
if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
  throw new Error("Expected an HTTP(S) Magpie URL without embedded credentials")
}

const parameters = {
  type: "object", properties: { value: { type: "string", enum: ["magpie-check"] } },
  required: ["value"], additionalProperties: false,
}
const prompt = "Call the echo tool exactly once with value equal to magpie-check."
const description = "Echo the supplied value."
const cases = [
  {
    model: `${provider}/claude-haiku-4-5-20251001`, api: "/v1/messages", kind: "anthropic",
    body: {
      messages: [{ role: "user", content: prompt }], max_tokens: 2048,
      tools: [{ name: "echo", description, input_schema: parameters }],
      tool_choice: { type: "tool", name: "echo" },
    },
  },
  {
    model: `${provider}/gpt-6.1-sol`, api: "/v1/responses", kind: "responses",
    body: {
      input: prompt, max_output_tokens: 2048, reasoning: { effort: "low" },
      tools: [{ type: "function", name: "echo", description, parameters, strict: true }],
      tool_choice: { type: "function", name: "echo" },
    },
  },
  {
    model: `${provider}/deepseek-v4.1-flash`, api: "/v1/chat/completions", kind: "chat",
    body: {
      messages: [{ role: "user", content: prompt }], max_tokens: 2048,
      tools: [{ type: "function", function: { name: "echo", description, parameters } }],
      tool_choice: { type: "function", function: { name: "echo" } },
    },
  },
]

function streamState(kind) {
  const tools = new Map(), aliases = new Map()
  let events = 0, complete = false, serverError = false, finishReason = null, sentinel = false
  const tool = (id) => {
    if (!tools.has(id)) tools.set(id, { name: "", arguments: "", initial: null, done: false })
    return tools.get(id)
  }
  const responseTool = (data, item = {}) => {
    const id = item.id ?? data.item_id
    const index = data.output_index
    let existing = id ? aliases.get(`id:${id}`) : undefined
    if (existing === undefined && index !== undefined) existing = aliases.get(`index:${index}`)
    const target = existing ?? id ?? `index:${index ?? tools.size}`
    if (id) aliases.set(`id:${id}`, target)
    if (index !== undefined) aliases.set(`index:${index}`, target)
    return tool(target)
  }
  return {
    accept(event, raw) {
      events++
      if (raw === "[DONE]") { sentinel = true; return }
      let data
      try { data = JSON.parse(raw) } catch { throw new Error("InvalidSSEJSON") }
      const type = data.type ?? event
      if (event === "error" || type === "error" || data.error || data.response?.error) serverError = true
      if (kind === "anthropic") {
        if (type === "content_block_start" && data.content_block?.type === "tool_use") {
          const t = tool(data.index)
          t.name = data.content_block.name ?? ""
          t.initial = data.content_block.input ?? null
        } else if (type === "content_block_delta" && data.delta?.type === "input_json_delta") {
          tool(data.index).arguments += data.delta.partial_json ?? ""
        } else if (type === "content_block_stop" && tools.has(data.index)) {
          tool(data.index).done = true
        } else if (type === "message_delta" && data.delta?.stop_reason) {
          finishReason = data.delta.stop_reason
        } else if (type === "message_stop") {
          complete = true
        }
      } else if (kind === "responses") {
        if (["response.output_item.added", "response.output_item.done"].includes(type) && data.item?.type === "function_call") {
          const t = responseTool(data, data.item)
          t.name = data.item.name ?? t.name
          if (typeof data.item.arguments === "string" && (data.item.arguments || type.endsWith(".done"))) t.arguments = data.item.arguments
          if (type.endsWith(".done")) t.done = true
        } else if (type === "response.function_call_arguments.delta") {
          responseTool(data).arguments += data.delta ?? ""
        } else if (type === "response.function_call_arguments.done") {
          const t = responseTool(data)
          if (typeof data.arguments === "string") t.arguments = data.arguments
          t.name = data.name ?? t.name
          t.done = true
        } else if (type === "response.completed") {
          for (const [index, item] of (data.response?.output ?? []).entries()) {
            if (item.type !== "function_call") continue
            const t = responseTool({ output_index: index }, item)
            t.name = item.name ?? t.name
            if (typeof item.arguments === "string") t.arguments = item.arguments
            t.done = true
          }
          complete = !data.response?.status || data.response.status === "completed"
          if (data.response?.incomplete_details) complete = false
        } else if (["response.failed", "response.incomplete"].includes(type)) {
          serverError = true
        }
      } else {
        for (const choice of data.choices ?? []) {
          if ((choice.index ?? 0) !== 0) continue
          for (const call of choice.delta?.tool_calls ?? []) {
            const t = tool(call.index ?? 0)
            t.name += call.function?.name ?? ""
            t.arguments += call.function?.arguments ?? ""
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason
            for (const t of tools.values()) t.done = true
          }
        }
      }
    },
    result() {
      const calls = [...tools.values()]
      const nameValid = calls.length === 1 && calls[0].name === "echo"
      let argsValid = false
      if (calls.length === 1 && calls[0].done) {
        try {
          const args = calls[0].arguments ? JSON.parse(calls[0].arguments) : calls[0].initial
          argsValid = !!args && !Array.isArray(args) && typeof args === "object"
            && args.value === "magpie-check" && Object.keys(args).length === 1
        } catch { /* Incomplete or invalid tool JSON is a failed check. */ }
      }
      const completed = kind === "chat" ? sentinel && finishReason === "tool_calls"
        : kind === "anthropic" ? complete && finishReason === "tool_use" : complete
      return {
        event_count: events, tool_count: calls.length, tool_name_valid: nameValid,
        tool_arguments_valid: argsValid, completed, server_error: serverError,
      }
    },
  }
}

async function readSSE(body, state) {
  const reader = body.getReader(), decoder = new TextDecoder()
  let buffer = "", event = "", data = [], bytes = 0
  const dispatch = () => {
    if (data.length) state.accept(event, data.join("\n"))
    event = ""; data = []
  }
  const line = (value) => {
    if (!value) { dispatch(); return }
    if (value.startsWith(":")) return
    const colon = value.indexOf(":"), field = colon < 0 ? value : value.slice(0, colon)
    let content = colon < 0 ? "" : value.slice(colon + 1)
    if (content.startsWith(" ")) content = content.slice(1)
    if (field === "event") event = content
    if (field === "data") data.push(content)
  }
  const drain = (final = false) => {
    while (true) {
      const match = /\r\n|\r|\n/.exec(buffer)
      if (!match || (!final && match[0] === "\r" && match.index === buffer.length - 1)) break
      line(buffer.slice(0, match.index))
      buffer = buffer.slice(match.index + match[0].length)
    }
    if (final && buffer) { line(buffer); buffer = "" }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 8 * 1024 * 1024) throw new Error("SSETooLarge")
      buffer += decoder.decode(chunk.value, { stream: true })
      drain()
    }
    buffer += decoder.decode()
    drain(true)
    dispatch()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

const results = []
for (const check of cases) {
  const state = streamState(check.kind), started = performance.now()
  let status = 0, error = null
  try {
    const response = await fetch(`${base}${check.api}`, {
      method: "POST", signal: AbortSignal.timeout(45_000),
      headers: {
        Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream",
        ...(check.kind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}),
      },
      body: JSON.stringify({ model: check.model, stream: true, ...check.body }),
    })
    status = response.status
    if (!response.ok) { await response.body?.cancel(); throw new Error("HTTPError") }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") || !response.body) {
      await response.body?.cancel()
      throw new Error("ExpectedSSE")
    }
    await readSSE(response.body, state)
  } catch (failure) {
    // Never log URLs, headers, raw responses, or exception messages from fetch.
    error = ["TimeoutError", "AbortError"].includes(failure.name) ? failure.name
      : ["HTTPError", "ExpectedSSE", "InvalidSSEJSON", "SSETooLarge"].includes(failure.message) ? failure.message : "TransportError"
  }
  const result = { model: check.model, api: check.api, status, duration_ms: Math.round(performance.now() - started), ...state.result(), error }
  result.usable = status >= 200 && status < 300 && !error && !result.server_error
    && result.completed && result.tool_name_valid && result.tool_arguments_valid
  results.push(result)
  console.log(JSON.stringify(result))
}
const report = {
  timestamp: new Date().toISOString(), route: "Magpie gateway -> Factory plugin -> Factory API",
  stream: true, max_output_tokens: 2048, timeout_ms: 45_000,
  checked: results.length, usable: results.filter((result) => result.usable).length, results,
}
if (process.env.MAGPIE_TEST_TOOLS_RESULT) await writeFile(process.env.MAGPIE_TEST_TOOLS_RESULT, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ checked: report.checked, usable: report.usable }))
if (report.usable !== cases.length) process.exitCode = 1
