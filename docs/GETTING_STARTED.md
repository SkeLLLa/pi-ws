# Getting Started

`pi-ws` embeds a WebSocket bridge in a Node.js process. Each `/ws/pi` connection
starts a local Pi coding-agent RPC subprocess and forwards JSON objects between
the WebSocket client and Pi's JSONL stdin/stdout protocol.

```text
browser/client -> WebSocket JSON -> pi-ws -> pi --mode rpc
```

## Prerequisites

- Node.js `>=22.19.0`.
- pnpm `>=10` when working in this repository.
- A configured provider for
  [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent),
  usually through an API key such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
  another provider-specific variable.

For repository development, use the checked-in tool versions:

```bash
mise install
pnpm install
```

## Install In An App

```bash
pnpm add pi-ws
```

or:

```bash
npm install pi-ws
```

## Start A Minimal Server

Create a server file in your app:

```ts
import { PiWs } from 'pi-ws';

const bridge = new PiWs({
  host: '127.0.0.1',
  port: 8787,
});

bridge.handle({
  method: 'get',
  path: '/health/application',
  handler: (res) => {
    res
      .writeHeader('content-type', 'application/json')
      .end(JSON.stringify({ ok: true }));
  },
});

await bridge.listen();
```

The Pi route is available at:

```text
ws://127.0.0.1:8787/ws/pi
```

## Send A First Message

Clients send JSON objects as WebSocket text frames. The bridge rejects invalid
JSON and non-object payloads before they reach the Pi subprocess.

```js
const ws = new WebSocket('ws://127.0.0.1:8787/ws/pi');

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'get_state' }));
});

ws.addEventListener('message', (event) => {
  if (typeof event.data === 'string') {
    console.log(JSON.parse(event.data));
  } else {
    console.log('binary artifact bytes', event.data);
  }
});
```

The first server message is usually a `pi_ws_ready` event with session metadata.
Generated artifact files are sent as metadata text frames plus binary frames.

## Run The Repository Example

From the repository root:

```bash
OPENAI_API_KEY='sk-...' PI_PROVIDER=openai PI_MODEL='gpt-4.1' mise run examples:chat
```

Then open:

```text
http://127.0.0.1:8787/examples/chat/
```

See [examples/README.md](../examples/README.md) for other providers, proxy base
URLs, auth tokens, artifact previews, logs, and sandbox directories.

## Add Basic Token Auth

Authentication is opt-in. For a small built-in token policy:

```ts
import { createStaticTokenAuthHook, PiWs } from 'pi-ws';

const bridge = new PiWs();

bridge.addHook(
  'onAuth',
  createStaticTokenAuthHook({
    token: process.env.PI_WS_AUTH_TOKEN ?? 'change-me',
    queryParam: 'token',
  }),
);

await bridge.listen();
```

Browser clients can authenticate with a reserved first WebSocket message:

```json
{ "token": "change-me", "type": "pi_ws_auth" }
```

Use your application's existing auth stack when you need users, sessions,
permissions, audit trails, or organization policy.

## Next Steps

- Read the [security guide](SECURITY.md) before exposing the bridge outside a
  trusted development network.
- Read the [API reference](api/index.md) when embedding custom routes or hooks.
- Read the [contributing guide](CONTRIBUTING.md) before opening a pull request.

