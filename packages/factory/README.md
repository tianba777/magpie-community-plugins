# @magpie-community/opencode-factory-auth

Signs in to a [Factory](https://factory.ai) (Droid) subscription and sends
model requests to Factory's API the way `droid` sends them. Provider id:
`factory`.

## This fork

Version `0.1.5-fork.1` adds GPT-6.1 Sol, corrects Haiku's missing limits
and the full context windows of Opus/Sonnet 5.5, and preserves Request
cancellation and binary-view model routing. Request bodies, instructions,
tools and image content remain unchanged.

This fork was tested as a **Magpie plugin** on October 2, 2026. An isolated
Magpie v0.1.604 Docker container loaded the package and signed-in account;
all 31 models were selected explicitly and called through its gateway as
`factory-plugin/<model>`. The tested account received **403 on all 31**:
21 Standard and 10 Droid Core models, with no generated text. Nikki
confirmed the requests used the Taiwan proxy. Loading successfully and
passing offline tests do not establish usable inference.

See the [Magpie verification report](../../docs/factory-verification-20261002.md)
and [redacted gateway results](../../docs/factory-magpie-live-20261002.json).
The fork version has not been published to npm. To load this checkout in
Magpie, use the absolute path to `packages/factory` with `magpie plugin add`;
in Docker, mount that directory and use its container path. With the
built-in Factory provider present, Magpie registers the plugin as
`factory-plugin`. The sign-in hook still uses `factory`.

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

## Use

```sh
magpie plugin add @magpie-community/opencode-factory-auth
magpie plugin login factory
```
