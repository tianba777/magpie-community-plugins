// The auth fetch wrapper must preserve the caller's request, cancellation,
// and response stream. All upstreams below are local fetch mocks: no account
// or Factory service is contacted.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { FactoryAuthPlugin } from "./index.mjs"

const realFetch = globalThis.fetch
const encoder = new TextEncoder()
const API = "https://api.factory.ai"
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2sAAAAASUVORK5CYII="
const prompt = "  You are OpenCode, the best coding agent on the planet.\nYou are powered by the model named fixture.\n保留空白、标点和原文。"
const argumentsText = '{ "quote": "You are powered by the model named fixture.", "path": "a\\\\b", "unicode": "台湾" }'

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("Unexpected fetch: request tests must use their mock upstream")
  }
})
afterEach(() => (globalThis.fetch = realFetch))

const account = () => ({
  type: "oauth",
  access: "request-test-access",
  refresh: "request-test-refresh",
  expires: Date.now() + 3_600_000,
  accountId: "request-test",
  activeOrganizationId: "fac_test",
  region: "",
  premBaseHost: "",
})

async function loaded(serve) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.pathname.includes("/llm/")) throw new Error("Unexpected non-model request: " + url.pathname)
    return serve(url, init)
  }
  let auth = account()
  const hooks = await FactoryAuthPlugin({ client: { auth: { set: async ({ body }) => (auth = body) } } })
  return hooks.auth.loader(async () => auth)
}

async function bytes(body) {
  if (typeof body === "string") return encoder.encode(body)
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

const fixtures = [
  {
    name: "Anthropic",
    path: "/api/llm/a/v1/messages",
    upstream: "anthropic",
    body: {
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      system: [
        { type: "text", text: prompt, cache_control: { type: "ephemeral", ttl: "5m" } },
        { type: "text", text: "Second system block stays separate." },
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: prompt }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "Preserved reasoning", signature: "opaque-signature" }, { type: "redacted_thinking", data: "opaque-redacted-data" }, { type: "tool_use", id: "tool_a", name: "lookup", input: { quoted: prompt, code: "return 'OpenCode';" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_a", content: [{ type: "text", text: prompt }], is_error: false }] },
      ],
      tools: [{ name: "lookup", description: prompt, input_schema: { type: "object", properties: { quoted: { type: "string" } } } }],
    },
  },
  {
    name: "Responses",
    path: "/api/llm/o/v1/responses",
    upstream: "openai",
    body: {
      model: "gpt-6.1-sol",
      instructions: prompt,
      previous_response_id: "resp_previous",
      input: [
        { role: "developer", content: [{ type: "input_text", text: prompt }] },
        { role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: "data:image/png;base64," + PNG, detail: "low" }] },
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: argumentsText },
        { type: "function_call_output", call_id: "call_1", output: prompt },
      ],
      tools: [{ type: "function", name: "lookup", description: prompt, parameters: { type: "object", properties: { quote: { type: "string" } } } }],
    },
  },
  {
    name: "Chat Completions",
    path: "/api/llm/o/v1/chat/completions",
    upstream: "fireworks",
    body: {
      model: "deepseek-v4.1-flash",
      messages: [
        { role: "system", content: [{ type: "text", text: prompt }] },
        { role: "developer", content: "Keep this role and message position." },
        { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: "data:image/png;base64," + PNG, detail: "low" } }] },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: argumentsText } }] },
        { role: "tool", tool_call_id: "call_1", content: prompt },
      ],
      tools: [{ type: "function", function: { name: "lookup", description: prompt, parameters: { type: "object", properties: { quote: { type: "string" } } } } }],
    },
  },
]

for (const fixture of fixtures) {
  test(fixture.name + " preserves body bytes, prompts, tools, images and message order", async () => {
    const body = " \n" + JSON.stringify(fixture.body, null, 2) + "\n  "
    const calls = []
    const l = await loaded(async (url, init) => {
      calls.push({ url, init, body: await bytes(init.body) })
      return new Response("{}", { status: 200 })
    })
    const url = API + fixture.path
    let input = url
    let init = { method: "POST", headers: { "Content-Type": "application/json" }, body }
    if (fixture.name === "Responses") {
      // A typed-array subview must not leak the bytes around its range.
      const padded = encoder.encode("prefix" + body + "suffix")
      init.body = padded.subarray(6, padded.length - 6)
    } else if (fixture.name === "Chat Completions") {
      input = new Request(url, init)
      init = undefined
    }
    const res = await l.fetch(input, init)
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe(fixture.path)
    expect(calls[0].init.method).toBe("POST")
    expect(calls[0].body).toEqual(encoder.encode(body))
    const h = new Headers(calls[0].init.headers)
    expect(h.get("x-api-provider")).toBe(fixture.upstream)
    expect(h.get("Authorization")).toBe("Bearer request-test-access")
    expect(h.get("Content-Type")).toBe("application/json")
  })
}

test("a streamed request body preserves fragmented UTF-8 bytes", async () => {
  const body = encoder.encode(JSON.stringify(fixtures[0].body))
  const split = body.indexOf(0xe4) + 1
  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(body.slice(0, split))
      controller.enqueue(body.slice(split))
      controller.close()
    },
  })
  let sent
  const l = await loaded(async (_url, init) => {
    sent = await bytes(init.body)
    return new Response("{}")
  })
  await l.fetch(API + fixtures[0].path, { method: "POST", body: streamed })
  expect(sent).toEqual(body)
})

for (const View of [DataView, Uint16Array]) {
  test(View.name + " preserves body bytes and routes MiniMax M2.7 to Fireworks", async () => {
    let raw = JSON.stringify({
      model: "minimax-m2.7",
      max_tokens: 64,
      system: prompt,
      messages: [{ role: "user", content: "Keep this message unchanged." }],
    }, null, 2)
    // Uint16Array needs an even byte count. Padding remains legal JSON
    // whitespace; bytes outside the view must never enter the request.
    if (encoder.encode(raw).byteLength % 2) raw += "\n"
    const original = encoder.encode(raw)
    const padded = new Uint8Array(original.byteLength + 8)
    padded.fill(0xff)
    padded.set(original, 4)
    const body = View === DataView
      ? new DataView(padded.buffer, 4, original.byteLength)
      : new Uint16Array(padded.buffer, 4, original.byteLength / 2)
    let sent
    const l = await loaded(async (url, init) => {
      sent = { url, headers: new Headers(init.headers), body: await bytes(init.body) }
      return new Response("{}")
    })
    expect((await l.fetch(API + fixtures[0].path, { method: "POST", body })).status).toBe(200)
    expect(sent.body).toEqual(original)
    expect(sent.url.pathname).toBe(fixtures[0].path)
    expect(sent.headers.get("x-api-provider")).toBe("fireworks")
  })
}

test("model metadata chooses each legal SDK route, including GPT-6.1 and MiniMax M2.7", async () => {
  const hooks = await FactoryAuthPlugin({ client: { auth: { set: async () => {} } } })
  const config = {}
  await hooks.config(config)
  for (const [id, npm, path] of [
    ["claude-sonnet-4-6", "@ai-sdk/anthropic", "/api/llm/a/v1"],
    ["minimax-m2.7", "@ai-sdk/anthropic", "/api/llm/a/v1"],
    ["gpt-6.1-sol", "@ai-sdk/openai", "/api/llm/o/v1"],
    ["gpt-6-sol", "@ai-sdk/openai", "/api/llm/o/v1"],
    ["grok-4.6", "@ai-sdk/openai", "/api/llm/o/v1"],
    ["deepseek-v4.1-flash", "@ai-sdk/openai-compatible", "/api/llm/o/v1"],
    ["glm-5.2", "@ai-sdk/openai-compatible", "/api/llm/o/v1"],
  ]) {
    expect(config.provider.factory.models[id]?.provider).toEqual({ npm, api: API + path })
  }
})

test("Request.signal cancels an in-flight model request", async () => {
  const controller = new AbortController()
  const reason = new DOMException("request fixture cancelled", "AbortError")
  let called
  const started = new Promise((resolve) => (called = resolve))
  let rejectPending
  let inherited
  const l = await loaded((_url, init) => {
    inherited = init.signal
    called()
    return new Promise((_resolve, reject) => {
      rejectPending = reject
      if (init.signal?.aborted) return reject(init.signal.reason)
      init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true })
    })
  })
  const request = new Request(API + fixtures[1].path, { method: "POST", body: JSON.stringify(fixtures[1].body), signal: controller.signal })
  const result = l.fetch(request).then((response) => ({ response }), (error) => ({ error }))
  try {
    await started
    expect(inherited).toBe(request.signal)
    controller.abort(reason)
    expect((await result).error).toBe(reason)
  } finally {
    controller.abort(reason)
    rejectPending?.(reason)
  }
})

test("init.signal overrides a cancelled Request.signal", async () => {
  const original = new AbortController()
  const override = new AbortController()
  const request = new Request(API + fixtures[1].path, { method: "POST", body: JSON.stringify(fixtures[1].body), signal: original.signal })
  original.abort(new DOMException("original cancelled", "AbortError"))
  let sent
  const l = await loaded((_url, init) => {
    sent = init.signal
    return new Response("{}")
  })
  const res = await l.fetch(request, { signal: override.signal })
  expect(res.status).toBe(200)
  expect(sent).toBe(override.signal)
  expect(sent.aborted).toBe(false)
})

test("an explicit null signal overrides a cancelled Request.signal", async () => {
  const controller = new AbortController()
  const request = new Request(API + fixtures[1].path, { method: "POST", body: JSON.stringify(fixtures[1].body), signal: controller.signal })
  controller.abort()
  let sent
  const l = await loaded((_url, init) => {
    sent = init.signal
    return new Response("{}")
  })
  const res = await l.fetch(request, { signal: null })
  expect(res.status).toBe(200)
  expect(sent).toBeNull()
})

for (const kind of ["Request", "init"]) {
  test("a pre-cancelled " + kind + " signal sends no model request", async () => {
    const controller = new AbortController()
    const reason = new DOMException("pre-cancelled fixture", "AbortError")
    controller.abort(reason)
    const url = API + fixtures[1].path
    const init = { method: "POST", body: JSON.stringify(fixtures[1].body), signal: controller.signal }
    const input = kind === "Request" ? new Request(url, init) : url
    let calls = 0
    const l = await loaded(() => {
      calls++
      return new Response("{}")
    })
    await expect(l.fetch(input, kind === "Request" ? undefined : init)).rejects.toThrow("pre-cancelled fixture")
    expect(calls).toBe(0)
  })
}

for (const fixture of fixtures) {
  test(fixture.name + " returns a 200 SSE stream before the upstream finishes", async () => {
    // Split a multibyte character between chunks; the wrapper must forward
    // bytes rather than parse, re-encode, or wait for the terminal event.
    const all = encoder.encode('event: delta\ndata: {"text":"台湾","arguments":"{\\"quote\\":\\"exact\\"}"}\n\nevent: done\ndata: [DONE]\n\n')
    const split = all.indexOf(0xe5) + 1
    const first = all.slice(0, split)
    const second = all.slice(split)
    let upstream
    let closed = false
    const finish = () => {
      if (closed) return
      closed = true
      upstream.enqueue(second)
      upstream.close()
    }
    const stream = new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(first) } })
    const l = await loaded(() => new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "X-Upstream": "fixture" } }))
    // Release a faulty buffering wrapper too, so a failed assertion leaves
    // no pending stream or promise behind.
    const fallback = setTimeout(finish, 1000)
    try {
      const res = await l.fetch(API + fixture.path, { method: "POST", body: JSON.stringify({ ...fixture.body, stream: true }) })
      expect(closed).toBe(false)
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("text/event-stream")
      expect(res.headers.get("X-Upstream")).toBe("fixture")
      const reader = res.body.getReader()
      expect(await reader.read()).toEqual({ value: first, done: false })
      expect(closed).toBe(false)
      finish()
      expect(await reader.read()).toEqual({ value: second, done: false })
      expect(await reader.read()).toEqual({ value: undefined, done: true })
    } finally {
      clearTimeout(fallback)
      finish()
    }
  })
}
