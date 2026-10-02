# @magpie-community/opencode-factory-auth

Signs in to a [Factory](https://factory.ai) (Droid) subscription and sends
model requests to Factory's API the way `droid` sends them. Provider id:
`factory`.

## This fork

Version `0.1.5-fork.2` implements the supplied compatibility report at the
`auth.loader.fetch` layer, which Magpie uses for all three model APIs:

- Prefix Anthropic system text, Responses instructions, and the first Chat
  system message with `You are Droid, an AI software engineering agent built by Factory.`
- Apply the report's two exact phrase substitutions to message text.
- Keep Anthropic text blocks and their cache controls; convert Responses
  instructions to a string; merge Chat system/developer prose into the
  first string system message.

These changes modify prompt text and Chat instruction placement. Tool
arguments and schemas, images, IDs, signed reasoning and response streams
are preserved. Shaping is idempotent and limited to the three Factory LLM
paths; invalid JSON and unknown paths pass through unchanged.

The fork also adds GPT-6.1 Sol, corrects model limits, carries cancellation
signals, handles binary-view offsets and removes stale Content-Length
headers after reshaping. **49 offline tests and all 11 package checks pass.**

On October 2, 2026, an isolated **Magpie v0.1.604 Docker gateway** with a
Taiwan Nikki proxy returned **200 and generated content on all 31 routes**
(21 Standard, 10 Droid Core). Native SSE tool calls passed for Anthropic,
Responses and Chat. A container restart restored all models; three probes
with the earlier baseline's 128-token cap also returned content.

Model-return caveat: a `minimax-m2.7` request returned
`accounts/fireworks/models/minimax-m3`. That route worked, but the response
does not verify M2.7 itself. All returned model names are recorded.

The earlier `.1` test lacked request shaping and received 403; it could
not establish whether the report's method works. See the
[verification report](../../docs/factory-verification-20261002.md),
[current gateway results](../../docs/factory-magpie-shaped-live-20261002.json),
[SSE tool results](../../docs/factory-magpie-stream-tools-20261002.json), and
[pre-shaping baseline](../../docs/factory-magpie-live-20261002.json).

This fork has not been published to npm. To load this checkout in Magpie,
use the absolute path to `packages/factory` with `magpie plugin add`; in
Docker, mount the directory and use its container path. With built-in
Factory present, the plugin provider is `factory-plugin`; its sign-in hook
still uses `factory`.

## Sign-in

- **Sign in with Factory (device code).** This is WorkOS's device flow
  under droid's own client. The browser opens Factory's page with the code
  filled in. Confirm it there, and the plugin picks up the tokens.
- **Organization.** A token that isn't in an organization yet is put in
  the first one your account belongs to.
- **Whoami.** The plugin asks `whoami` for your active organization, its
  region (EU orgs go to `api.eu.factory.ai`) and any host of the org's
  own. Every request then carries them, as droid's do.

## Where the sign-in is kept

The sign-in is kept wherever the host keeps provider sign-ins:

- OpenCode: `~/.local/share/opencode/auth.json`
- magpie: `plugin-auth.json`

It holds WorkOS's access and refresh tokens, with the organization,
region and host.

**Refreshing.** The access token is renewed two minutes before it lapses.
WorkOS rotates the refresh token, so the plugin never runs two refreshes
at once.

**Refusals.** If Factory refuses the organization a request names, the
plugin asks `whoami` again and resends the request once. If the refusal
stands, the error says what to check.

## Models

Each model is served on the one API droid uses for it:

| API | Models |
|---|---|
| Anthropic Messages (`/api/llm/a`) | Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5.5, Sonnet 5, Sonnet 4.6, Haiku 4.5, MiniMax M2.7 |
| OpenAI Responses (`/api/llm/o/v1`) | GPT-6.1 Sol, GPT-6 Sol/Astra/Luna, GPT-5.6 Sol/Terra/Luna, GPT-5.5, GPT-5.4, GPT-5.3-Codex, Grok 4.7, Grok 4.6 |
| Chat completions (`/api/llm/o/v1`) | GLM-5.3, GLM-5.3-Flash, GLM-5.2, Kimi K3, DeepSeek V4.1 Flash, Qwen3.8 Max, MiniMax M3, Mistral Medium 3.5, Nemotron 3 Ultra |

Reasoning efforts are the variants droid offers for each model.

The list is not included:

- Gemini, which Factory sends on a route of its own.
- auto, which droid picks on the client side.

## Use this fork in Magpie

```sh
git clone --branch factory-transport-models https://github.com/tianba777/magpie-community-plugins.git
magpie plugin add "$PWD/magpie-community-plugins/packages/factory"
magpie plugin login factory
```

For Docker, mount the cloned package into the container and pass its
container path to `magpie plugin add`. Client requests use
`factory-plugin/<model>` when the built-in Factory provider is present.
The plugin sign-in is independent of the built-in account. Select explicit
model IDs to expose all models: Magpie's default list is limited to 24, and
`provider models ... all` restores that default rather than exposing 31.
