# @magpie-community/opencode-devin-auth

Signs in to a [Devin](https://devin.ai) subscription, the account the
`devin` CLI uses, and makes its requests, in OpenCode and in magpie.
Provider id: `devin`.

## Magpie Docker sign-in fork

Version `0.1.6-fork.1` adds a remote sign-in method for browsers running on
a different computer from Magpie. It keeps the upstream inference,
credential format and provider ID `devin`, so existing plugin accounts
remain compatible. The npm package name is unchanged.

Choose **Devin (remote/Docker: paste callback URL)** in Magpie. Open the
authorization link and sign in on Devin's website. The browser's final
`http://127.0.0.1:<port>/callback?...` page may show a connection error;
copy its complete address and paste it into Magpie's waiting input.
Do not remove its `code` or `state`, or reuse an address from an older
sign-in attempt. The authorization attempt expires after ten minutes.

The plugin validates the callback against that attempt and exchanges the
code directly with Devin's fixed API endpoint. It does not visit the
pasted URL, open a network listener, or require a new Docker port. Existing
local browser and CLI sign-in methods remain available.

On October 2, 2026, a user completed authorization through the new method
and Magpie saved one account. Its separate account proxy used a Nikki
Taiwan route; country.is reported TW and Nikki observed `server.codeium.com`
through the Taiwan node. A real `devin-plugin/swe-2` request returned
HTTP 200, model `swe-2` and text `OK`. After a container restart, the sign-in
and proxy remained in place and the same request succeeded again.

The source is on the fork's `devin-docker-signin` branch; use the absolute
`packages/devin` directory with `magpie plugin add`. For an existing npm
installation, first add the local fork, then remove that exact npm registration;
leave the Factory plugin and all account data in place.

## Signing in

An account is the CLI's session token (`devin-session-token$…`). The fork
offers the remote method above in addition to these original methods:

- **Devin (browser)**: the CLI's own `devin auth login`, run by the
  plugin. It is a PKCE sign-in through `app.devin.ai/auth/cli/continue`
  back to a callback on `127.0.0.1`. The code is exchanged for the token
  at `server.codeium.com` (`ExchangeDevinCLIPKCECode`).
- **Devin CLI's sign-in**: takes the account the CLI is signed in to, from
  its `credentials.toml` (`$XDG_DATA_HOME/devin/`, by default
  `~/.local/share/devin/`; `%APPDATA%\devin\` on Windows). The file is only
  read, never changed. In Docker this means the CLI credential file inside
  the container, not a sign-in file on the browser's computer.

When the CLI is installed, the plugin names the account with
`devin auth status` (its email and tier). The CLI runs with a data folder
of the plugin's own, `~/.cache/opencode-devin-auth/<hash of the token>/`,
so the CLI's own sign-in is never touched. Without the CLI the account is
named "Devin".

The token is kept where OpenCode keeps sign-ins (`auth.json`; in magpie,
`plugin-auth.json`) as `{ "type": "api", "key", "metadata": { "email", "plan" } }`.
Devin doesn't expire it on a schedule, so there is nothing to refresh;
when it is refused, requests fail with a 401 saying to sign in again.

## Requests

Devin serves chat through Windsurf's API server, as the CLI does:
`POST https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage`,
a Connect RPC in protobuf, with `Authorization: Basic <token>`.
`WINDSURF_API_SERVER_URL` moves the server, as it does for the CLI.

The plugin's `fetch` handles this:

- It turns OpenCode's chat completion into the CLI's request (devin-cli
  3000.11.3).
  - The system prompt goes at the head of the first user message.
  - Each tool's description goes there too, in a `<tool_descriptions>`
    block, and the tool is sent with a pointer to it. Devin answers "an
    internal error occurred" to some agents' tool descriptions when they
    are sent as the tools' own.
  - A tool call the conversation never answered is answered with "Tool use
    was interrupted and did not produce a result."
  - Images must be inline (`data:` URLs); images in tool results are
    dropped.
- It turns the streamed reply back into a chat completion, streamed or
  not: text, reasoning, tool calls and usage.
- Failures keep their statuses: a refused token is a 401, a usage limit a
  429, a prompt too long for the model a 400.

## Models

Devin's models are families: `swe-2`, `claude-opus-5-5`, `gpt-6-sol`, …
Each family has variants at each effort (`swe-2-high`,
`claude-opus-5-5-xhigh`), and some have a fast or priority run
(`claude-opus-5-5-high-fast`). The plugin lists each family once, with
the efforts its variants are at, plus its fast or priority run
(`claude-opus-5-5-fast`). The variant asked for is the one at the effort
picked, or the nearest the family has; with none picked, the family's
default. Variants at no effort (`glm-5-2-1m`) are listed as they are.
Adaptive and Fusion aren't listed; they route between models inside
Devin's own agent.

The `config` hook declares Devin's list as of 2026-09-30 (87 models).
Once signed in, and with the CLI installed, the `provider.models` hook
replaces it with the account's own, from `devin models list`. The list is
cached for 5 minutes; after a failed read, the plugin tries again after 1
minute.

## Not included

magpie's built-in Devin account does more than this plugin:

- **Usage**: the plan's quota windows.
- **Several accounts** at once.
- **Web search**: its stand-in for Anthropic's server-side web search tool.
