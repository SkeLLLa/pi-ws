# Codestyle Refactoring Plan

Enforce two conventions across `src/`:

1. **Prefer classes** over modules that export a bag of functions (esp. factory functions that return closures holding private state).
2. **Object args** — `fn(args: { ... })` instead of positional `fn(a, b, c)`.

> **Breaking-change warning.** This is a published library (`1.0.1`) with a tracked public API surface (`etc/pi-ws.api.md`, `docs/api/*`). Any change to an exported signature is a **major** semver bump. Plan splits work into *internal* (safe, patch) and *public* (breaking, batch into one major) buckets.

---

## Conventions (target style)

### Rule 1 — Classes

Use a `class` when code has any of:

- Private state held in a closure (factory returning an object/closure).
- A lifecycle (start → use → stop, open → message → close).
- Multiple related functions sharing the same first param (cohesion smell).

Keep as free functions:

- Pure stateless helpers (`parseJsonObject`, path math).
- Thin one-shot factories that are genuinely the public ergonomic API (`definePiWsConfig`).

### Rule 2 — Object args

```ts
// before
function pushFlag(args: string[], flag: string, value: string | undefined): void

// after
function pushFlag(args: { target: string[]; flag: string; value?: string }): void
```

Apply when a function takes **2+ params**. Exceptions (keep positional):

- Single-param functions (already compliant).
- Variadic rest (`composeAuthorizers(...authorizers)`).
- **External contracts** — `uWebSockets.js` behavior callbacks (`open(ws)`, `message(ws, msg, isBinary)`, `upgrade(res, req, context)`). These signatures are dictated by the lib; do **not** wrap.

---

## Inventory

| File | Current shape | Rule 1 | Rule 2 |
|------|---------------|--------|--------|
| `pi/rpc-process.ts` | `startPiRpcProcess()` + `createPiRpcProcess()` closure | **class** | yes |
| `server/auth.ts` | 4 exported fns; `createStaticTokenAuthorizer` returns closure | **class** + helpers | yes |
| `pi/resolve-pi-command.ts` | `resolvePiCommand()` + private helpers | **class** (optional) | yes (internal) |
| `ws/pi-route.ts` | `createPiWebSocketRoute()` factory | **class** | n/a (1 arg) |
| `server/static.ts` | `installChatExampleRoutes()` + helpers | **class** | yes (internal) |
| `server/config.ts` | `loadConfig`/`createDefaultConfig` + ~25 private fns | **class** (internal) | yes (internal) |
| `server/server.ts` | `PiWs` class (good) + free helpers | partial | yes (`handle`/`route` public) |
| `utils/jsonl.ts` | `JsonlSplitter` class + `parseJsonObject` | OK | OK |
| `bin/pi-ws.ts` | script | OK | OK |
| `index.ts` | re-exports | OK | OK |

---

## Phase 1 — Internal-only refactors (non-breaking, patch)

No public signature changes. Safe to ship incrementally.

### 1.1 `pi/rpc-process.ts` → `PiRpcProcess` class

Closure in `createPiRpcProcess` holds `closed` + `child`. Lifecycle = spawn/send/close. Collapse `startPiRpcProcess` + `createPiRpcProcess` into one class.

```ts
export class PiRpcProcess {
  #child: ChildProcessWithoutNullStreams;
  #closed = false;

  constructor(args: { config: PiProcessConfig; handlers: PiRpcProcessHandlers }) { ... }

  send(message: Record<string, unknown>): void { ... }
  close(): void { ... }
}
```

- `startPiRpcProcess(config, handlers)` → `new PiRpcProcess({ config, handlers })`.
- Keep `PiRpcProcessHandlers` interface.
- Update caller `ws/pi-route.ts` (`data.peer = new PiRpcProcess({...})`).
- `getErrorMessage`, `resolvePiEnvironment` → private statics/methods.
- These types are **not** in `index.ts` exports → internal, no semver impact.

### 1.2 `server/config.ts` → internal `ConfigResolver` class

~25 private helpers all thread `env`/`PiWsOptions` positionally. Group into a class that holds `env` once; drop it from every helper signature.

```ts
class ConfigResolver {
  readonly #env: NodeJS.ProcessEnv;
  constructor(args: { env: NodeJS.ProcessEnv }) { ... }

  defaults(): PiWsOptions { ... }
  loadEnvOverrides(): PiWsOptions { ... }
  resolve(args: { config: PiWsOptions }): PiWsConfig { ... }
  // mergeOptions, mergePiOptions, parsePort... become methods
}
```

- Public `loadConfig()` / `createDefaultConfig()` / `definePiWsConfig` signatures **unchanged** — they become thin wrappers over `ConfigResolver`.
- Positional helpers (`parsePositiveInteger(value, name)`, `optionalValue(value, key)`, `mergeOptionalObject(base, override, key)`) → object args as methods.

### 1.3 `pi/resolve-pi-command.ts` → `PiCommandResolver` (optional) + object-arg helpers

- `resolvePiCommand(config)` is 1 arg → Rule 2 compliant. Class optional (low value; pure).
- Internal `pushFlag(args, flag, value)` and `stripModeArgs` → object args.
- Recommend: keep module function, just fix `pushFlag` to object arg. Skip class.

### 1.4 `server/static.ts` → `ChatExampleRoutes` class + object-arg helpers

- `serveFile(res, root, requestedPath)` and `resolveSafePath(root, requestedPath)` → object args.
- `installChatExampleRoutes(app)` is internal (called from `server.ts`). Convert to class holding `#root`:

```ts
class ChatExampleRoutes {
  #root = CHAT_EXAMPLE_DIR;
  install(args: { app: TemplatedApp }): void { ... }
}
```

### 1.5 `server/server.ts` free helpers → object args

Internal helpers: `listen(app, host, port)`, `createRunningServer(app, socket, port)`, `mergeConfig`, `mergeTlsConfig`, `createUwsApp`, `toUwsTlsOptions` → object args. `PiWs` class stays.

---

## Phase 2 — Public API refactors (breaking, one major bump)

Batch **all** of these into a single major release. Update `etc/pi-ws.api.md` + `docs/api/*` + `examples/`.

### 2.1 `server/auth.ts` → `StaticTokenAuthorizer` class + object-arg guards

`createStaticTokenAuthorizer(options)` already object-arg (1 arg) ✓. But it returns a bare closure holding state → make a class implementing the `RequestAuthorizer` shape.

```ts
export class StaticTokenAuthorizer {
  constructor(options: StaticTokenAuthorizerOptions) { ... }
  authorize(request: AuthorizationRequest): AuthorizationResult { ... }
}
```

Positional public fns → object args:

- `protectHttpHandler(handler, authorize)` → `protectHttpHandler({ handler, authorize })`
- `protectWebSocketBehavior(behavior, authorize, createUserData?)` → `protectWebSocketBehavior({ behavior, authorize, createUserData })`
- `composeAuthorizers(...authorizers)` — variadic, **keep** (exception).

> Decision needed: keep `createStaticTokenAuthorizer` as a deprecated factory wrapper for one major cycle, or hard-cut. Recommend keep + `@deprecated` to ease migration.

### 2.2 `PiWs` public positional methods → object args

- `handle(method, path, handler)` → `handle({ method, path, handler })`
- `route(path, behavior)` → `route({ path, behavior })`
- `createPiWsServer(config, installers)` → `createPiWsServer({ config, installers })`
- Single-arg chainables (`configure`, `configurePi`, `authorize`, …) already compliant — leave.

### 2.3 `ws/pi-route.ts`

`createPiWebSocketRoute(options)` 1 arg ✓. Internalize as `PiWebSocketRoute` class for consistency (not exported → could be Phase 1). Behavior callbacks stay positional (uWS contract).

---

## Execution order

1. **Phase 1.1** rpc-process class (isolated, 1 caller).
2. **Phase 1.3 / 1.4 / 1.5** internal object-arg sweeps.
3. **Phase 1.2** config resolver (largest internal churn).
4. Ship Phase 1 as patch/minor. Verify `pnpm test` green at each step.
5. **Phase 2** on a dedicated branch — auth + PiWs API. Update api-extractor output, regenerate `docs/api/`, bump major, update examples + README.

## Verification gates

- `pnpm test` after every file (existing tests: `test/config.test.ts`, `test/pi-ws.test.ts`, `test/resolve-pi-command.test.ts`).
- `pnpm build` + api-extractor — confirm Phase 1 produces **zero** diff in `etc/pi-ws.api.md`.
- Phase 2: review `etc/pi-ws.api.md` diff = intended breaking set, nothing more.
- Add tests for new object-arg signatures before deleting positional ones (TDD).

## Out of scope / keep as-is

- `uWebSockets.js` callback signatures (`open`/`message`/`close`/`upgrade`).
- `parseJsonObject`, `JsonlSplitter` (already compliant).
- `definePiWsConfig`, single-arg factories.
- `bin/pi-ws.ts`, `index.ts` re-exports.
