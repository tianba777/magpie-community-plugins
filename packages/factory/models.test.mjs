// Exercise the public config/auth hooks loaded by Magpie.
// Token limits: https://platform.claude.com/docs/en/models/haiku-4-5/overview
// GPT-6.1: https://developers.openai.com/api/docs/models/gpt-6.1-sol
// Factory IDs/efforts: https://docs.factory.com/models
import { afterEach, expect, test } from "bun:test"
import { FactoryAuthPlugin } from "./index.mjs"

const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))

async function configured(config = {}) {
  const hooks = await FactoryAuthPlugin({ client: { auth: { set: async () => {} } } })
  await hooks.config(config)
  return { hooks, models: config.provider.factory.models }
}

test("Haiku declares usable context and output limits to the host", async () => {
  const { models } = await configured()
  const haiku = models["claude-haiku-4-5-20251001"]
  expect(haiku.limit).toEqual({ context: 200_000, output: 64_000 })
  expect(haiku.provider).toEqual({ npm: "@ai-sdk/anthropic", api: "https://api.factory.ai/api/llm/a/v1" })
})

test("Opus and Sonnet 5.5 expose the full window, leaving output reservation to the host", async () => {
  const { models } = await configured()
  for (const id of ["claude-opus-5-5", "claude-sonnet-5-5"]) {
    expect(models[id].limit).toEqual({ context: 1_000_000, output: 128_000 })
  }
})

test("GPT-6.1 selects Responses with its supported limits and reasoning levels", async () => {
  const { models } = await configured()
  const gpt = models["gpt-6.1-sol"]
  expect(gpt.name).toBe("GPT-6.1 Sol")
  expect(gpt.provider).toEqual({ npm: "@ai-sdk/openai", api: "https://api.factory.ai/api/llm/o/v1" })
  expect(gpt.limit).toEqual({ context: 1_050_000, output: 128_000 })
  expect(gpt.variants).toEqual({
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    xhigh: { reasoningEffort: "xhigh" },
    max: { reasoningEffort: "max" },
  })
  expect(gpt.reasoning).toBe(true)
  expect(gpt.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
})

test("explicit user model settings still override the catalog", async () => {
  const override = { name: "My Haiku", limit: { context: 100_000, output: 8_000 }, temperature: false }
  const custom = { name: "Private model", provider: { npm: "@ai-sdk/openai-compatible", api: "https://example.invalid/v1" } }
  const config = { provider: { factory: { models: { "claude-haiku-4-5-20251001": override, "my-model": custom } } } }
  const { models } = await configured(config)
  expect(models["claude-haiku-4-5-20251001"]).toBe(override)
  expect(models["my-model"]).toBe(custom)
  expect(models["gpt-6.1-sol"].limit.context).toBe(1_050_000)
})

test("GPT-6.1 fetch signs Responses as OpenAI and adds instructions without changing input", async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: init.body })
    return Response.json({ id: "offline-response", output: [] })
  }
  const auth = {
    type: "oauth",
    access: "offline-test-access",
    refresh: "offline-test-refresh",
    expires: Date.now() + 3_600_000,
    accountId: "offline-test-account",
    activeOrganizationId: "offline-test-org",
  }
  const hooks = await FactoryAuthPlugin({ client: { auth: { set: async () => { throw new Error("a live test token must not be refreshed") } } } })
  const config = {}
  await hooks.config(config)
  const model = config.provider.factory.models["gpt-6.1-sol"]
  const loader = await hooks.auth.loader(async () => auth)
  const body = JSON.stringify({
    model: model.id,
    input: [{ role: "user", content: "Keep this submitted text unchanged." }],
    reasoning: { effort: "low" },
    max_output_tokens: 128,
    stream: false,
  })
  const res = await loader.fetch(model.provider.api + "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "host-placeholder" },
    body,
  })
  expect(res.status).toBe(200)
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("https://api.factory.ai/api/llm/o/v1/responses")
  expect(calls[0].headers.get("x-api-provider")).toBe("openai")
  expect(calls[0].headers.get("Authorization")).toBe("Bearer offline-test-access")
  expect(calls[0].headers.get("x-api-key")).toBeNull()
  expect(JSON.parse(calls[0].body)).toEqual({
    ...JSON.parse(body),
    instructions: "You are Droid, an AI software engineering agent built by Factory.",
  })
})
