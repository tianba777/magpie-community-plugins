// Remote/Docker sign-in is a pasted loopback callback URL, not a request
// to a browser machine from the container. All exchanges here stay offline.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DevinAuthPlugin, _internal } from "./index.mjs"

const fetchOriginal = globalThis.fetch
const envNames = ["PATH", "XDG_CACHE_HOME", "XDG_DATA_HOME", "WINDSURF_API_SERVER_URL"]
let savedEnv, scratch, requests
const sampleKey = "test-session-key-never-public"
const sampleCode = "test-authorization-code-never-public"

beforeEach(() => {
  savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]))
  scratch = mkdtempSync(join(tmpdir(), "devin-signin-"))
  const bin = join(scratch, "bin")
  mkdirSync(bin)
  // cliPath finds our file before any installed CLI. Its missing interpreter
  // makes spawn fail locally with ENOENT; no child can contact the network.
  writeFileSync(join(bin, "devin"), "#!/no-such-devin-test-interpreter\n", { mode: 0o700 })
  chmodSync(join(bin, "devin"), 0o700)
  process.env.PATH = bin
  process.env.XDG_CACHE_HOME = join(scratch, "cache")
  process.env.XDG_DATA_HOME = join(scratch, "data")
  delete process.env.WINDSURF_API_SERVER_URL
  requests = []
  globalThis.fetch = async () => { throw new Error("Unexpected public-network request in sign-in test") }
})
afterEach(() => {
  globalThis.fetch = fetchOriginal
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  rmSync(scratch, { recursive: true, force: true })
})

const authParams = (flow) => new URL(flow.url).searchParams
function callbackURL(flow, code = sampleCode) {
  const params = authParams(flow), callback = new URL(params.get("redirect_uri"))
  callback.searchParams.set("state", params.get("state"))
  callback.searchParams.set("code", code)
  return callback
}
async function flowWith(options = {}) {
  const exchanges = []
  const flow = await _internal.pasteSignIn({
    exchange: async (code, verifier, redirect) => { exchanges.push({ code, verifier, redirect }); return { key: sampleKey } },
    success: async (key) => ({ type: "success", provider: "devin", key, metadata: { email: "Devin" } }),
    ...options,
  })
  return { flow, exchanges }
}
function expectSafeFailure(result) {
  expect(result.type).toBe("failed")
  expect(typeof result.error).toBe("string")
  expect(result.error.length).toBeGreaterThan(0)
  expect(JSON.stringify(result)).not.toContain(sampleKey)
  expect(JSON.stringify(result)).not.toContain(sampleCode)
  expect(JSON.stringify(result)).not.toContain("sensitive-error-description")
}

test("remote/Docker paste flow is first, while local auto and CLI choices remain", async () => {
  const hooks = await DevinAuthPlugin()
  expect(hooks.auth.methods).toHaveLength(3)
  const [remote, local, cli] = hooks.auth.methods
  expect(remote.type).toBe("oauth")
  expect(remote.label).toMatch(/remote.*Docker/i)
  expect(local.label).toBe("Devin (browser)")
  expect(cli.label).toBe("Devin CLI's sign-in")
  expect(typeof local.authorize).toBe("function")
  const remoteFlow = await remote.authorize()
  expect(remoteFlow.method).toBe("code")
  expect(typeof remoteFlow.callback).toBe("function")
  const cliFlow = await cli.authorize()
  expect(cliFlow.method).toBe("auto")
  expect(cliFlow.url).toBe("")
  expectSafeFailure(await cliFlow.callback())
})

test("authorization has a fresh state and S256 challenge; exchange uses that verifier and exact redirect", async () => {
  const { flow, exchanges } = await flowWith()
  const authorize = new URL(flow.url), params = authorize.searchParams
  expect(authorize.origin + authorize.pathname).toBe("https://app.devin.ai/auth/cli/continue")
  expect(params.get("prompt")).toBe("select_account")
  expect(params.get("cli_pkce_marker")).toBe("1")
  expect(params.get("code_challenge_method")).toBe("S256")
  expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{32,}$/)
  expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const redirect = new URL(params.get("redirect_uri"))
  expect(redirect.protocol).toBe("http:")
  expect(redirect.hostname).toBe("127.0.0.1")
  expect(redirect.pathname).toBe("/callback")
  expect(Number(redirect.port)).toBeGreaterThan(0)
  expect(Number(redirect.port)).toBeLessThan(65536)
  expect(redirect.search).toBe("")
  const result = await flow.callback(callbackURL(flow).href)
  expect(result).toEqual({ type: "success", provider: "devin", key: sampleKey, metadata: { email: "Devin" } })
  expect(exchanges).toHaveLength(1)
  expect(exchanges[0].code).toBe(sampleCode)
  expect(exchanges[0].redirect).toBe(params.get("redirect_uri"))
  expect(exchanges[0].verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
  expect(createHash("sha256").update(exchanges[0].verifier).digest("base64url")).toBe(params.get("code_challenge"))
  expect(flow.url).not.toContain(exchanges[0].verifier)
  const second = await flowWith()
  expect(authParams(second.flow).get("state")).not.toBe(params.get("state"))
  expect(authParams(second.flow).get("code_challenge")).not.toBe(params.get("code_challenge"))
})

const badCallbacks = [
  ["host", (url) => { url.hostname = "evil.example" }],
  ["localhost alias", (url) => { url.hostname = "localhost" }],
  ["scheme", (url) => { url.protocol = "https:" }],
  ["port", (url) => { url.port = String(Number(url.port) === 65535 ? 65534 : Number(url.port) + 1) }],
  ["path", (url) => { url.pathname = "/callback/other" }],
  ["state", (url) => { url.searchParams.set("state", "wrong-state") }],
  ["missing state", (url) => { url.searchParams.delete("state") }],
  ["missing code", (url) => { url.searchParams.delete("code") }],
  ["empty code", (url) => { url.searchParams.set("code", "") }],
  ["URL credentials", (url) => { url.username = "user"; url.password = "sensitive-error-description" }],
  ["fragment", (url) => { url.hash = "sensitive-error-description" }],
  ["duplicate state", (url) => { url.searchParams.append("state", url.searchParams.get("state")) }],
  ["duplicate code", (url) => { url.searchParams.append("code", sampleCode) }],
]
for (const [kind, mutate] of badCallbacks) {
  test(`a callback with wrong ${kind} is rejected before any exchange and allows correction`, async () => {
    const { flow, exchanges } = await flowWith(), invalid = callbackURL(flow)
    mutate(invalid)
    expectSafeFailure(await flow.callback(invalid.href))
    expect(exchanges).toHaveLength(0)
    expect((await flow.callback(callbackURL(flow).href)).type).toBe("success")
    expect(exchanges).toHaveLength(1)
  })
}

test("a code alone or invalid URL cannot trigger a network exchange", async () => {
  const { flow, exchanges } = await flowWith()
  for (const invalid of [sampleCode, "not a URL", "", undefined]) expectSafeFailure(await flow.callback(invalid))
  expect(exchanges).toHaveLength(0)
})

test("a wrong-state OAuth error cannot cancel a legitimate flow", async () => {
  const { flow, exchanges } = await flowWith(), invalid = callbackURL(flow)
  invalid.searchParams.set("state", "wrong-state")
  invalid.searchParams.set("error", "access_denied")
  invalid.searchParams.set("error_description", "sensitive-error-description")
  expectSafeFailure(await flow.callback(invalid.href))
  expect((await flow.callback(callbackURL(flow).href)).type).toBe("success")
  expect(exchanges).toHaveLength(1)
})

test("a matching-state OAuth refusal is sealed safely and cannot exchange later", async () => {
  const { flow, exchanges } = await flowWith(), denied = callbackURL(flow)
  denied.searchParams.set("error", "sensitive-error-description")
  denied.searchParams.set("error_description", `${sampleKey} ${sampleCode}`)
  const failure = await flow.callback(denied.href)
  expectSafeFailure(failure)
  expect(await flow.callback(callbackURL(flow).href)).toEqual(failure)
  expect(exchanges).toHaveLength(0)
})

test("the ten-minute deadline rejects a late callback and permanently closes its exchange", async () => {
  let now = 1_000
  const { flow, exchanges } = await flowWith({ now: () => now })
  now += 10 * 60 * 1_000
  const failure = await flow.callback(callbackURL(flow).href)
  expectSafeFailure(failure)
  expect(failure.error).toMatch(/timed out|expired/i)
  now = 1_001
  expect(await flow.callback(callbackURL(flow).href)).toEqual(failure)
  expect(exchanges).toHaveLength(0)
})

test("a callback just before the deadline is still accepted", async () => {
  let now = 1_000
  const { flow, exchanges } = await flowWith({ now: () => now })
  now += 10 * 60 * 1_000 - 1
  expect((await flow.callback(callbackURL(flow).href)).type).toBe("success")
  expect(exchanges).toHaveLength(1)
})

test("a previous flow's callback cannot sign in a new flow", async () => {
  const first = await flowWith(), second = await flowWith()
  expectSafeFailure(await second.flow.callback(callbackURL(first.flow).href))
  expect(second.exchanges).toHaveLength(0)
  expect((await second.flow.callback(callbackURL(second.flow).href)).type).toBe("success")
  expect(second.exchanges).toHaveLength(1)
})

test("concurrent and repeated valid callbacks share one exchange and success result", async () => {
  let release, exchanges = 0, successes = 0
  const waiting = new Promise((resolve) => { release = resolve })
  const { flow } = await flowWith({
    exchange: async () => { exchanges++; await waiting; return { key: sampleKey } },
    success: async (key) => { successes++; return { type: "success", provider: "devin", key, metadata: { email: "Devin" } } },
  })
  const first = flow.callback(callbackURL(flow).href), second = flow.callback(callbackURL(flow).href)
  await Promise.resolve()
  expect(exchanges).toBe(1)
  release()
  const [a, b] = await Promise.all([first, second])
  expect(a.type).toBe("success")
  expect(b).toEqual(a)
  expect(await flow.callback(callbackURL(flow).href)).toEqual(a)
  expectSafeFailure(await flow.callback(callbackURL(flow, "different-code").href))
  expect(exchanges).toBe(1)
  expect(successes).toBe(1)
})

test("exchange exceptions are safe, terminal, and are not retried by duplicate callbacks", async () => {
  let exchanges = 0
  const { flow } = await flowWith({ exchange: async () => { exchanges++; throw new Error(`${sampleKey} ${sampleCode} sensitive-error-description`) } })
  const failure = await flow.callback(callbackURL(flow).href)
  expectSafeFailure(failure)
  expect(await flow.callback(callbackURL(flow).href)).toEqual(failure)
  expect(exchanges).toBe(1)
})

test("account-identification exceptions cannot expose a code or session token", async () => {
  const { flow, exchanges } = await flowWith({ success: async () => { throw new Error(`${sampleKey} ${sampleCode}`) } })
  const failure = await flow.callback(callbackURL(flow).href)
  expectSafeFailure(failure)
  expect(await flow.callback(callbackURL(flow).href)).toEqual(failure)
  expect(exchanges).toHaveLength(1)
})

test("public remote hook exchanges PKCE offline and succeeds when the CLI is unavailable", async () => {
  globalThis.fetch = async (url, init) => {
    expect(String(url)).toBe("https://server.codeium.com/exa.seat_management_pb.SeatManagementService/ExchangeDevinCLIPKCECode")
    requests.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
    return Response.json({ sessionToken: sampleKey })
  }
  const hooks = await DevinAuthPlugin(), flow = await hooks.auth.methods[0].authorize()
  const result = await flow.callback(callbackURL(flow).href)
  expect(result).toEqual({ type: "success", provider: "devin", key: sampleKey, metadata: { email: "Devin" } })
  expect(requests).toHaveLength(1)
  expect(requests[0].body).toMatchObject({ code: sampleCode, redirect_uri: authParams(flow).get("redirect_uri") })
  expect(createHash("sha256").update(requests[0].body.code_verifier).digest("base64url")).toBe(authParams(flow).get("code_challenge"))
  expect(requests[0].headers).toMatchObject({ "Content-Type": "application/json", Accept: "application/json" })
  expect(flow.instructions).not.toContain(sampleKey)
  expect(flow.instructions).not.toContain(sampleCode)
  expect(result.metadata).not.toHaveProperty("cli")
})

test("the public hook never leaks a failed exchange's response body", async () => {
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    return new Response(`${sampleKey} ${sampleCode} sensitive-error-description`, { status: 401 })
  }
  const hooks = await DevinAuthPlugin(), flow = await hooks.auth.methods[0].authorize()
  const failure = await flow.callback(callbackURL(flow).href)
  expectSafeFailure(failure)
  expect(await flow.callback(callbackURL(flow).href)).toEqual(failure)
  expect(requests).toHaveLength(1)
})

test("the retained CLI method reads only its isolated credential file and keeps the local account marker", async () => {
  const dir = join(process.env.XDG_DATA_HOME, "devin")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "credentials.toml"), `windsurf_api_key = "${sampleKey}"\n`, { mode: 0o600 })
  const hooks = await DevinAuthPlugin(), flow = await hooks.auth.methods[2].authorize()
  const result = await flow.callback()
  expect(result).toEqual({ type: "success", provider: "devin", key: sampleKey, metadata: { email: "Devin", cli: true } })
  expect(flow.instructions).not.toContain(sampleKey)
  expect(flow.instructions).not.toContain(sampleCode)
})
