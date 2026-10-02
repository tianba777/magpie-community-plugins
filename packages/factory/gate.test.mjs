// Offline generic-agent request contracts: only the system format and
// Factory identity prefix change. No account or remote service is contacted.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { _internal } from "./index.mjs"

const realFetch = globalThis.fetch
const API = "https://api.factory.ai"
const MESSAGES = "/api/llm/a/v1/messages"
const RESPONSES = "/api/llm/o/v1/responses"
const CHAT = "/api/llm/o/v1/chat/completions"
const IDENTITY = "You are Droid, an AI software engineering agent built by Factory."
const OPEN_CODE = "You are OpenCode, the best coding agent on the planet."
const POWERED = "You are powered by the model named fixture."

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("Gate unit tests must not access the network") }
})
afterEach(() => (globalThis.fetch = realFetch))

function shaped(path, body) {
  return JSON.parse(_internal.shapeBody(API + path, JSON.stringify(body)))
}

test("Anthropic string system keeps the agent's original wording after the exact identity", () => {
  expect(shaped(MESSAGES, {
    model: "claude-sonnet-4-6",
    system: " \n" + OPEN_CODE + "\n" + POWERED,
    messages: [{ role: "user", content: "  " + OPEN_CODE + "\n" + POWERED }],
    max_tokens: 128,
  })).toEqual({
    model: "claude-sonnet-4-6",
    system: IDENTITY + "\n\n" + OPEN_CODE + "\n" + POWERED,
    messages: [{ role: "user", content: "  " + OPEN_CODE + "\n" + POWERED }],
    max_tokens: 128,
  })
})

test("Anthropic preserves cache metadata, later system blocks and ordinary text objects", () => {
  const cache = { type: "ephemeral", ttl: "1h" }
  expect(shaped(MESSAGES, {
    model: "claude-sonnet-4-6",
    system: [
      { type: "text", text: "First instruction.", cache_control: cache },
      { type: "text", text: OPEN_CODE + " " + POWERED, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: { type: "text", text: OPEN_CODE + " " + POWERED, cache_control: cache } }],
  })).toEqual({
    model: "claude-sonnet-4-6",
    system: [
      { type: "text", text: IDENTITY + "\n\nFirst instruction.", cache_control: cache },
      { type: "text", text: OPEN_CODE + " " + POWERED, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: { type: "text", text: OPEN_CODE + " " + POWERED, cache_control: cache } }],
  })
})

test("Anthropic single-object system normalizes to a block array without losing cache_control", () => {
  expect(shaped(MESSAGES, {
    system: { type: "text", text: POWERED, cache_control: { type: "ephemeral", ttl: "5m" } },
    messages: [],
  })).toEqual({
    system: [{ type: "text", text: IDENTITY + "\n\n" + POWERED, cache_control: { type: "ephemeral", ttl: "5m" } }],
    messages: [],
  })
})

test("Responses prefixes instructions while preserving string input exactly", () => {
  expect(shaped(RESPONSES, {
    model: "gpt-6.1-sol", instructions: " " + POWERED,
    input: "  " + OPEN_CODE + "\n" + POWERED,
    reasoning: { effort: "low" }, stream: true,
  })).toEqual({
    model: "gpt-6.1-sol", instructions: IDENTITY + "\n\n" + POWERED,
    input: "  " + OPEN_CODE + "\n" + POWERED,
    reasoning: { effort: "low" }, stream: true,
  })
})

test("Responses instruction arrays flatten their text in order and retain input objects", () => {
  const image = { type: "input_image", image_url: "data:image/png;base64,opaque-image", detail: "high" }
  const argumentsText = '{"text":"' + OPEN_CODE + '","other":"' + POWERED + '"}'
  expect(shaped(RESPONSES, {
    instructions: [{ type: "text", text: "First." }, { type: "text", text: POWERED }],
    previous_response_id: "resp_previous",
    input: [
      { type: "message", role: "developer", content: { type: "input_text", text: OPEN_CODE } },
      { role: "user", content: [{ type: "input_text", text: POWERED }, image] },
      { type: "function_call", id: "fc_original", call_id: "call_original", name: "lookup", arguments: argumentsText },
      { type: "function_call_output", call_id: "call_original", output: POWERED },
      { role: "assistant", content: [{ type: "output_text", text: OPEN_CODE + " " + POWERED }] },
    ],
  })).toEqual({
    instructions: IDENTITY + "\n\nFirst.\n\n" + POWERED,
    previous_response_id: "resp_previous",
    input: [
      { type: "message", role: "developer", content: { type: "input_text", text: OPEN_CODE } },
      { role: "user", content: [{ type: "input_text", text: POWERED }, image] },
      { type: "function_call", id: "fc_original", call_id: "call_original", name: "lookup", arguments: argumentsText },
      { type: "function_call_output", call_id: "call_original", output: POWERED },
      { role: "assistant", content: [{ type: "output_text", text: OPEN_CODE + " " + POWERED }] },
    ],
  })
})

test("Chat merges interleaved system and developer content into the first string system", () => {
  expect(shaped(CHAT, {
    model: "deepseek-v4.1-flash",
    messages: [
      { role: "user", content: "First user stays first among ordinary messages." },
      { role: "developer", content: POWERED },
      { role: "system", content: [{ type: "text", text: "System A." }, { type: "text", text: OPEN_CODE }] },
      { role: "assistant", content: OPEN_CODE + "\n" + POWERED },
      { role: "developer", content: { type: "text", text: "Developer B." } },
      { role: "user", content: { type: "text", text: POWERED } },
      { role: "tool", tool_call_id: "call_original", content: OPEN_CODE + " " + POWERED },
    ],
  })).toEqual({
    model: "deepseek-v4.1-flash",
    messages: [
      { role: "system", content: IDENTITY + "\n\n" + POWERED + "\n\nSystem A.\n\n" + OPEN_CODE + "\n\nDeveloper B." },
      { role: "user", content: "First user stays first among ordinary messages." },
      { role: "assistant", content: OPEN_CODE + "\n" + POWERED },
      { role: "user", content: { type: "text", text: POWERED } },
      { role: "tool", tool_call_id: "call_original", content: OPEN_CODE + " " + POWERED },
    ],
  })
})

test("all message text, tool results, arguments, schemas, images and signed reasoning stay unchanged", () => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: OPEN_CODE }, cache_control: { type: "ephemeral" } }
  const assistant = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: OPEN_CODE, signature: POWERED },
      { type: "redacted_thinking", data: POWERED },
      { type: "tool_use", id: "tool_original", name: "lookup", input: { text: OPEN_CODE, nested: { text: POWERED } } },
      { type: "text", text: "  " + OPEN_CODE + "\n" + POWERED },
    ],
  }
  const tools = [{ name: "lookup", description: OPEN_CODE, input_schema: { type: "object", properties: { text: { type: "string", enum: [POWERED] } } } }]
  expect(shaped(MESSAGES, {
    system: "Keep constraints.", tools, thinking: { type: "enabled", budget_tokens: 2048 },
    messages: [
      { role: "user", content: [{ type: "text", text: OPEN_CODE }, image] },
      assistant,
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_original", content: { type: "text", text: POWERED }, is_error: false }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_original", content: "  " + OPEN_CODE + "\n" + POWERED }] },
    ],
  })).toEqual({
    system: IDENTITY + "\n\nKeep constraints.", tools, thinking: { type: "enabled", budget_tokens: 2048 },
    messages: [
      { role: "user", content: [{ type: "text", text: OPEN_CODE }, image] },
      assistant,
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_original", content: { type: "text", text: POWERED }, is_error: false }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_original", content: "  " + OPEN_CODE + "\n" + POWERED }] },
    ],
  })
})

for (const [name, path, body] of [
  ["Anthropic", MESSAGES, { system: " \n" + IDENTITY + "\n" + OPEN_CODE, messages: [] }],
  ["Responses", RESPONSES, { instructions: " \n" + IDENTITY + "\n" + OPEN_CODE, input: POWERED }],
  ["Chat", CHAT, { messages: [{ role: "system", content: " \n" + IDENTITY + "\n" + OPEN_CODE }, { role: "user", content: POWERED }] }],
]) {
  test(name + " keeps an exact leading identity and shaping is idempotent", () => {
    const once = _internal.shapeBody(API + path, JSON.stringify(body))
    const parsed = JSON.parse(once)
    const system = path === MESSAGES ? parsed.system : path === RESPONSES ? parsed.instructions : parsed.messages[0].content
    expect(system).toBe(IDENTITY + "\n" + OPEN_CODE)
    expect(system.split(IDENTITY)).toHaveLength(2)
    expect(_internal.shapeBody(API + path, once)).toBe(once)
  })
}

test("invalid JSON and JSON primitive or array roots pass through unchanged", () => {
  for (const path of [MESSAGES, RESPONSES, CHAT]) {
    for (const body of ["{broken", "", "null", "17", "true", '"plain JSON string"', "[{}]"]) {
      expect(_internal.shapeBody(API + path, body)).toBe(body)
    }
  }
})

test("non-LLM and near-match paths preserve string and binary body identity", () => {
  const text = ' {"system":"' + OPEN_CODE + '"} '
  const padded = new TextEncoder().encode("pad" + text + "pad")
  const body = new DataView(padded.buffer, 3, padded.byteLength - 6)
  for (const path of ["/api/cli/whoami", "/api/billing/limits", "/api/llm/a/v1/messages/other", "/other/api/llm/o/v1/responses", "/api/llm/o/v1/completions"]) {
    expect(_internal.shapeBody(API + path, text)).toBe(text)
    expect(_internal.shapeBody(API + path, body)).toBe(body)
  }
})

test("unknown content block types keep their text and nested payload verbatim", () => {
  const unknown = { type: "vendor_opaque", text: OPEN_CODE, content: { type: "text", text: POWERED }, signature: POWERED }
  expect(shaped(MESSAGES, { system: "Instruction.", messages: [{ role: "user", content: [unknown] }] })).toEqual({
    system: IDENTITY + "\n\nInstruction.", messages: [{ role: "user", content: [unknown] }],
  })
})

test("Chat merges only pure text instructions and retains non-text system content intact", () => {
  const image = { type: "image_url", image_url: { url: "data:image/png;base64," + POWERED } }
  const mixed = { role: "system", content: [{ type: "text", text: OPEN_CODE }, image] }
  const user = { role: "user", content: "  " + OPEN_CODE + "\n" + POWERED }
  const raw = JSON.stringify({ messages: [mixed, { role: "developer", content: POWERED }, user] })
  const once = _internal.shapeBody(API + CHAT, raw)
  expect(JSON.parse(once)).toEqual({
    messages: [{ role: "system", content: IDENTITY + "\n\n" + POWERED }, mixed, user],
  })
  expect(_internal.shapeBody(API + CHAT, once)).toBe(once)
})

test("opaque Responses instructions pass the whole body through without touching input", () => {
  const raw = JSON.stringify({
    instructions: [{ type: "vendor_opaque", text: OPEN_CODE, signature: POWERED }],
    input: "  " + OPEN_CODE + "\n" + POWERED,
  })
  expect(_internal.shapeBody(API + RESPONSES, raw)).toBe(raw)
})
