# pi-ws Examples

This directory contains runnable examples for using `pi-ws` as a library and
as a ready-made server.

## What Starts Pi?

For the WebSocket examples, you do not start Pi manually. `pi-ws` starts a
local Pi subprocess for each `/ws/pi` WebSocket connection:

```text
pi --mode rpc --no-session --session-dir <example-session-dir>
```

Manual Pi launch is only useful as a sanity check:

```bash
pnpm exec pi --mode rpc --no-session --provider openai --model gpt-4.1
```

Then type:

```json
{ "type": "get_state" }
```

Press Enter. Exit with `Ctrl+C`.

## Prerequisites

From the repository root:

```bash
mise install
pnpm install
```

You need at least one configured LLM provider. The fastest path is an API key in
the environment.

`examples/run-chat.mjs` also reads repository-root `.env` and `.env.local`.
Precedence is:

1. Variables already exported in the shell
2. `.env.local`
3. `.env`

Example `.env.local`:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://proxy.example.com/v1
PI_PROVIDER=openai
PI_MODEL=gpt-4.1
```

Then run:

```bash
mise run examples:chat
```

Common provider keys:

| Provider      | Environment variable |
| ------------- | -------------------- |
| OpenAI        | `OPENAI_API_KEY`     |
| Anthropic     | `ANTHROPIC_API_KEY`  |
| Google Gemini | `GEMINI_API_KEY`     |
| OpenRouter    | `OPENROUTER_API_KEY` |
| Mistral       | `MISTRAL_API_KEY`    |

The example launcher also accepts a generic `PI_API_KEY` and maps it to the
selected provider when possible.

Common provider base URLs:

| Provider      | Environment variable  |
| ------------- | --------------------- |
| OpenAI        | `OPENAI_BASE_URL`     |
| Anthropic     | `ANTHROPIC_BASE_URL`  |
| Google Gemini | `GOOGLE_BASE_URL`     |
| OpenRouter    | `OPENROUTER_BASE_URL` |
| Mistral       | `MISTRAL_BASE_URL`    |

`PI_BASE_URL` is the generic override and takes precedence over provider-specific
base URL variables.

## Recommended: mise Task

Run the browser chat example:

```bash
OPENAI_API_KEY='sk-...' PI_PROVIDER=openai PI_MODEL='gpt-4.1' mise run examples:chat
```

Open:

```text
http://127.0.0.1:8787/examples/chat/
```

The page connects to:

```text
ws://127.0.0.1:8787/ws/pi
```

The example also supports binary artifact previews. A natural prompt like
`draw a graph of pirate counts by century` should produce a preview card in the
UI because the bridge tells the agent to turn visual/file output into artifact
files. Images, audio, video, PDFs, text files, and CSV tables are displayed
inline. Every artifact also gets a blob URL download link, including
non-displayable binary files.

Optional auth for the built-in Pi route:

```bash
OPENAI_API_KEY='sk-...' \
  PI_PROVIDER=openai \
  PI_MODEL='gpt-4.1' \
  PI_WS_AUTH_TOKEN='dev-secret' \
  mise run examples:chat
```

When `PI_WS_AUTH_TOKEN` is set, the launcher installs an `onAuth` hook with
`createStaticTokenAuthHook()`. The browser example then authenticates with the
reserved first websocket message:

```json
{ "token": "dev-secret", "type": "pi_ws_auth" }
```

The chat page exposes an **Auth token** field and automatically sends that
message after `pi_ws_auth_required`.

## Artifacts, Logs, And Sandbox

The example launcher enables artifact transfer and process sandboxing by
default. Each websocket connection gets a short session id, shown in the chat
header after connection. Use that id to find the matching artifact and sandbox
directories.

Default paths:

| Purpose           | Default path                   |
| ----------------- | ------------------------------ |
| Artifact root     | `.tmp/pi-ws-example/artifacts` |
| Sandbox root      | `.tmp/pi-ws-example/sandbox`   |
| Session directory | `.tmp/pi-ws-example/sessions`  |
| Pino log file     | `.tmp/pi-ws-example/pi-ws.log` |

Each connection creates a per-session sandbox root under the sandbox root. The
agent receives cwd, `HOME`, and `TMPDIR` paths inside that session root. Tool
caches, package-manager state, and temporary files should stay under those
generic sandbox locations or the artifact directory.

Useful overrides:

| Variable                         | Meaning                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `PI_WS_ARTIFACTS_DIR`            | Artifact root directory                                       |
| `PI_WS_ARTIFACTS_LOG_LEVEL`      | Pino log level for artifact and sandbox events                |
| `PI_WS_ARTIFACTS_LOG_FILE`       | Pino log destination                                          |
| `PI_WS_SANDBOX_MODE`             | `off`, `process`, or `system`                                 |
| `PI_WS_SANDBOX_CWD`              | Root directory for per-connection sandbox working directories |
| `PI_WS_SANDBOX_ENV_POLICY`       | `inherit`, `minimal`, or `allowlist`                          |
| `PI_WS_SANDBOX_ALLOW_READ_DIRS`  | JSON string array of readable directories                     |
| `PI_WS_SANDBOX_ALLOW_WRITE_DIRS` | JSON string array of writable directories                     |

To watch the debug output while exercising artifact generation:

```bash
tail -f .tmp/pi-ws-example/pi-ws.log
```

For a step-by-step artifact debugging prompt sequence, see
`.tmp/artifact-debug-session-plan.md` in this repository.

### Using Anthropic

```bash
ANTHROPIC_API_KEY='sk-ant-...' \
  PI_PROVIDER=anthropic \
  PI_MODEL='claude-sonnet-4-5' \
  mise run examples:chat
```

### Using Google Gemini

```bash
GEMINI_API_KEY='...' \
  PI_PROVIDER=google \
  PI_MODEL='gemini-2.5-pro' \
  mise run examples:chat
```

### Using Generic `PI_API_KEY`

```bash
PI_API_KEY='sk-...' \
  PI_PROVIDER=openai \
  PI_MODEL='gpt-4.1' \
  mise run examples:chat
```

## Base URL / Proxy

Use `PI_BASE_URL` or a provider-specific base URL env var when your provider
traffic must go through a proxy, gateway, LM Studio, vLLM, Ollama-compatible
OpenAI endpoint, or another private endpoint.

Base URL precedence:

1. `PI_BASE_URL`
2. Provider-specific variable, for example `OPENAI_BASE_URL` or
   `ANTHROPIC_BASE_URL`
3. Pi's built-in provider default

Provider-specific example:

```bash
OPENAI_API_KEY='sk-...' \
  OPENAI_BASE_URL='https://proxy.example.com/v1' \
  PI_PROVIDER=openai \
  PI_MODEL='gpt-4.1' \
  mise run examples:chat
```

For OpenAI-compatible APIs:

```bash
PI_API_KEY='sk-...' \
  PI_PROVIDER=proxy-openai \
  PI_BASE_URL='https://proxy.example.com/v1' \
  PI_API='openai-completions' \
  PI_MODEL='gpt-4.1' \
  mise run examples:chat
```

The launcher writes a temporary Pi model config to:

```text
.tmp/pi-ws-example/agent/models.json
```

It also sets `PI_CODING_AGENT_DIR` to that directory for the running process, so
your real `~/.pi/agent/models.json` is not modified.

For Anthropic-compatible proxy APIs:

```bash
ANTHROPIC_API_KEY='sk-ant-...' \
  ANTHROPIC_BASE_URL='https://proxy.example.com' \
  PI_PROVIDER=anthropic \
  PI_API='anthropic-messages' \
  PI_MODEL='claude-sonnet-4-5' \
  mise run examples:chat
```

For local OpenAI-compatible servers:

```bash
PI_API_KEY='local' \
  PI_PROVIDER=local-openai \
  PI_BASE_URL='http://localhost:1234/v1' \
  PI_API='openai-completions' \
  PI_MODEL='qwen2.5-coder-7b' \
  mise run examples:chat
```

## Choosing Models

List models known to Pi for a built-in provider:

```bash
OPENAI_API_KEY='sk-...' pnpm exec pi --provider openai --list-models
```

Then pass the selected model:

```bash
OPENAI_API_KEY='sk-...' \
  PI_PROVIDER=openai \
  PI_MODEL='gpt-4.1' \
  mise run examples:chat
```

Pi also accepts provider-prefixed model patterns, but the examples keep provider
and model separate because it maps cleanly to environment variables.

## Ports And Host

Defaults:

| Variable     | Default     |
| ------------ | ----------- |
| `PI_WS_HOST` | `127.0.0.1` |
| `PI_WS_PORT` | `8787`      |

Override them:

```bash
OPENAI_API_KEY='sk-...' \
  PI_PROVIDER=openai \
  PI_MODEL='gpt-4.1' \
  PI_WS_PORT=9000 \
  mise run examples:chat
```

Then open:

```text
http://127.0.0.1:9000/examples/chat/
```

## Run Without mise

The mise task is only a convenience wrapper. You can use the package script:

```bash
OPENAI_API_KEY='sk-...' PI_PROVIDER=openai PI_MODEL='gpt-4.1' pnpm example:chat
```

Or run the launcher directly:

```bash
pnpm build
OPENAI_API_KEY='sk-...' PI_PROVIDER=openai PI_MODEL='gpt-4.1' node examples/run-chat.mjs
```

## Embedded Library Example

`embedded-server.mjs` demonstrates adding custom HTTP and WebSocket routes with
the library API:

```bash
pnpm build
OPENAI_API_KEY='sk-...' PI_PROVIDER=openai PI_MODEL='gpt-4.1' node examples/embedded-server.mjs
```

With optional built-in Pi auth and a matching protected HTTP route:

```bash
pnpm build
OPENAI_API_KEY='sk-...' \
  PI_PROVIDER=openai \
  PI_MODEL='gpt-4.1' \
  PI_WS_AUTH_TOKEN='dev-secret' \
  node examples/embedded-server.mjs
```

It exposes:

| URL                                    | Purpose                     |
| -------------------------------------- | --------------------------- |
| `http://127.0.0.1:8787/examples/chat/` | Browser chat UI             |
| `ws://127.0.0.1:8787/ws/pi`            | Pi RPC WebSocket            |
| `http://127.0.0.1:8787/api/hello`      | Custom HTTP route           |
| `ws://127.0.0.1:8787/ws/echo`          | Custom WebSocket echo route |

When `PI_WS_AUTH_TOKEN` is set, `embedded-server.mjs` also exposes:

| URL                                   | Purpose                                |
| ------------------------------------- | -------------------------------------- |
| `http://127.0.0.1:8787/api/private`   | Protected HTTP route using same token  |
| `ws://127.0.0.1:8787/ws/pi?token=...` | Query-param auth for non-browser tools |

## Troubleshooting

- If the chat connects but commands fail, expand **Raw events** in the UI.
- If Pi reports no model is available, verify the API key env var and run
  `pnpm exec pi --provider <provider> --list-models`.
- If you use `PI_BASE_URL`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, or another
  provider base URL, verify the temporary `.tmp/pi-ws-example/agent/models.json`
  provider name matches `PI_PROVIDER`.
- If you expose the server beyond localhost, add authentication/reverse-proxy
  controls before putting it on the internet.
