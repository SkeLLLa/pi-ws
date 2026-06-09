import type { LevelWithSilent } from 'pino';
import type {
  AppOptions,
  HttpRequest,
  HttpResponse,
  TemplatedApp,
  WebSocketBehavior,
} from 'uWebSockets.js';

/**
 * Structured view of an incoming HTTP or WebSocket-upgrade request.
 *
 * @remarks
 * Authorizers receive this object so they can inspect headers, query-string
 * parameters, and request metadata without depending on raw `uWebSockets.js`
 * objects.
 *
 * @public
 */
export interface AuthorizationRequest {
  /**
   * Request method, typically `GET` for WebSocket upgrade requests.
   */
  readonly method: string;
  /**
   * Full request URL path plus query string when present.
   */
  readonly url: string;
  /**
   * Request path without the query string.
   */
  readonly path: string;
  /**
   * Raw query string without the leading `?`.
   */
  readonly query: string;
  /**
   * Decoded query parameters. When a key appears multiple times, the first
   * value is kept.
   */
  readonly queryParams: Readonly<Record<string, string>>;
  /**
   * Lower-cased request headers.
   */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Remote peer IP address as text, when available.
   */
  readonly remoteAddress?: string;
}

/**
 * Successful authorization result.
 *
 * @public
 */
export interface AuthorizationSuccess {
  /**
   * Indicates the request is allowed.
   */
  readonly authorized: true;
}

/**
 * Failed authorization result.
 *
 * @remarks
 * Failures can customize the HTTP status, response headers, and body returned
 * to the client.
 *
 * @public
 */
export interface AuthorizationFailure {
  /**
   * Indicates the request is denied.
   */
  readonly authorized: false;
  /**
   * HTTP status line sent to the client.
   *
   * @defaultValue `"401 Unauthorized"`
   */
  readonly status?: string;
  /**
   * Extra response headers sent with the failure response.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Optional failure response body.
   */
  readonly body?: string;
}

/**
 * Result returned by a request authorizer.
 *
 * @public
 */
export type AuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

/**
 * Value that may be returned synchronously or asynchronously.
 *
 * @public
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Mutable context shared across request hooks during a single request or
 * WebSocket upgrade.
 *
 * @typeParam Session - Optional session value attached by hooks.
 * @public
 */
export interface RequestHookContext<Session = unknown> {
  /**
   * Optional authenticated session or principal resolved by hooks.
   */
  session?: Session;
  /**
   * Mutable bag for per-request state shared between hooks.
   */
  readonly locals: Record<string, unknown>;
}

/**
 * Result returned by a request hook.
 *
 * @remarks
 * Returning `undefined` or `{ authorized: true }` lets processing continue.
 * Hooks may either attach session data by mutating `context.session` or by
 * returning `{ session }`.
 *
 * @typeParam Session - Optional session value attached by hooks.
 * @public
 */
export interface RequestHookSuccess<Session = unknown> {
  /**
   * Indicates the request should continue.
   */
  readonly authorized?: true;
  /**
   * Optional authenticated session or principal produced by the hook.
   */
  readonly session?: Session;
}

/**
 * Result returned by a request hook.
 *
 * @remarks
 * Returning an [AuthorizationFailure](./pi-ws.authorizationfailure.md) rejects
 * the request immediately.
 *
 * @typeParam Session - Optional session value attached by hooks.
 * @public
 */
export type RequestHookResult<Session = unknown> =
  | AuthorizationFailure
  | RequestHookSuccess<Session>
  | undefined;

/**
 * Async-capable request hook used by the built-in Pi WebSocket route and
 * `protectWebSocketBehavior()`.
 *
 * @remarks
 * Hooks receive the structured request plus a mutable shared context. They can
 * deny the request, attach a `session`, or populate `locals` for later access.
 *
 * @param request - Structured request data.
 * @param context - Mutable per-request hook context.
 * @returns Optional authorization decision.
 * @public
 */
export type RequestHook<Session = unknown> = (
  request: AuthorizationRequest,
  context: RequestHookContext<Session>,
) => MaybePromise<RequestHookResult<Session>>;

/**
 * Source that supplied credentials to an auth hook.
 *
 * @public
 */
export type AuthSource = 'request' | 'message';

/**
 * Structured authentication data passed to an auth hook.
 *
 * @remarks
 * Browser clients usually cannot set arbitrary WebSocket upgrade headers, so
 * `pi-ws` can run auth from a reserved first websocket message as well as from
 * upgrade request metadata.
 *
 * @public
 */
export interface AuthHookInput {
  /**
   * Whether this auth attempt came from the upgrade request or a websocket
   * message.
   */
  readonly source: AuthSource;
  /**
   * Original HTTP upgrade request snapshot.
   */
  readonly request: AuthorizationRequest;
  /**
   * Indicates whether any supported credential material was present.
   */
  readonly provided: boolean;
  /**
   * Token extracted from a header, query parameter, or first-message envelope.
   */
  readonly token?: string;
  /**
   * Parsed first-message auth envelope when `source` is `"message"`.
   */
  readonly message?: Readonly<Record<string, unknown>>;
  /**
   * Optional custom payload supplied in the first-message auth envelope.
   */
  readonly payload?: unknown;
}

/**
 * Async-capable auth hook used by the built-in Pi WebSocket route.
 *
 * @typeParam Session - Optional session value attached by hooks.
 * @public
 */
export type AuthHook<Session = unknown> = (
  auth: AuthHookInput,
  context: RequestHookContext<Session>,
) => MaybePromise<RequestHookResult<Session>>;

/**
 * Read-only context associated with an upgraded WebSocket connection.
 *
 * @typeParam Session - Optional session value attached by hooks.
 * @public
 */
export interface WebSocketConnectionContext<Session = unknown> {
  /**
   * Original HTTP upgrade request snapshot.
   */
  readonly request: AuthorizationRequest;
  /**
   * Immutable copy of hook-local state collected during upgrade.
   */
  readonly locals: Readonly<Record<string, unknown>>;
  /**
   * Whether auth credentials were supplied during upgrade or first-message
   * auth.
   */
  readonly authProvided: boolean;
  /**
   * Whether configured auth hooks accepted the connection.
   */
  readonly authenticated: boolean;
  /**
   * Optional authenticated session or principal resolved during upgrade.
   */
  readonly session?: Session;
}

/**
 * Supported built-in Pi route hook names.
 *
 * @public
 */
export type PiWsHookName = 'onRequest' | 'onAuth';

/**
 * Hook collections for the built-in Pi WebSocket route.
 *
 * @public
 */
export interface PiWsHooks<Session = unknown> {
  /**
   * Runs before the built-in Pi route upgrades the WebSocket connection.
   */
  readonly onRequest?: readonly RequestHook<Session>[];
  /**
   * Runs when auth credentials are available from the upgrade request or from
   * the reserved first websocket message.
   */
  readonly onAuth?: readonly AuthHook<Session>[];
}

/**
 * Synchronous request authorizer used by `pi-ws` guards.
 *
 * @remarks
 * Authorizers are intentionally synchronous to keep route handling simple and
 * predictable with `uWebSockets.js`. If you need asynchronous or external auth,
 * use `PiWs.use()` and implement the route directly against `uWebSockets.js`.
 *
 * @param request - Structured request data.
 * @returns Authorization decision.
 * @public
 */
export type RequestAuthorizer = (
  request: AuthorizationRequest,
) => AuthorizationResult;

/**
 * TLS settings for running `pi-ws` over HTTPS / WSS.
 *
 * @remarks
 * These fields map directly to the `uWebSockets.js` SSL app options, but use
 * camelCase names to match the rest of the `pi-ws` configuration surface.
 *
 * @public
 */
export interface PiWsTlsConfig {
  /**
   * Path to the TLS private key PEM file.
   */
  readonly keyFileName: NonNullable<AppOptions['key_file_name']>;
  /**
   * Path to the TLS certificate PEM file.
   */
  readonly certFileName: NonNullable<AppOptions['cert_file_name']>;
  /**
   * Optional CA bundle file.
   */
  readonly caFileName?: AppOptions['ca_file_name'];
  /**
   * Optional TLS private-key passphrase.
   */
  readonly passphrase?: AppOptions['passphrase'];
  /**
   * Optional Diffie-Hellman parameters file.
   */
  readonly dhParamsFileName?: AppOptions['dh_params_file_name'];
  /**
   * Optional OpenSSL cipher suite override.
   */
  readonly sslCiphers?: AppOptions['ssl_ciphers'];
  /**
   * Prefer lower TLS memory usage.
   *
   * @defaultValue `false`
   */
  readonly preferLowMemoryUsage?: boolean;
}

/**
 * Process launch settings for the local Pi RPC subprocess.
 *
 * @remarks
 * These settings are passed to the child process that runs Pi in RPC mode.
 * `pi-ws` uses the bundled Pi CLI by default and prepends `--mode rpc` to the
 * configured argument list.
 *
 * @public
 */
export interface PiProcessConfig {
  /**
   * Explicit command to spawn instead of the bundled Pi CLI.
   */
  readonly command?: string;
  /**
   * Additional raw arguments passed to the Pi CLI process.
   *
   * @remarks
   * `pi-ws` always forces `--mode rpc` and then appends generated flags such as
   * `--model` or `--system-prompt` before these extra arguments.
   */
  readonly args: readonly string[];
  /**
   * Optional working directory for the Pi subprocess.
   */
  readonly cwd?: string;
  /**
   * Optional override for Pi's agent directory.
   *
   * @remarks
   * When set, `pi-ws` injects `PI_CODING_AGENT_DIR` into the spawned Pi
   * process environment. This is the easiest way to ship custom prompts,
   * extensions, skills, themes, and model configuration with your app.
   */
  readonly agentDir?: string;
  /**
   * Optional Pi provider name, such as `openai` or `anthropic`.
   */
  readonly provider?: string;
  /**
   * Optional Pi model pattern or full model ID.
   */
  readonly model?: string;
  /**
   * Optional Pi thinking level.
   */
  readonly thinking?: string;
  /**
   * Optional Pi session display name.
   */
  readonly sessionName?: string;
  /**
   * Optional system prompt replacement passed as `--system-prompt`.
   */
  readonly systemPrompt?: string;
  /**
   * Optional extra system prompt snippets passed as repeated
   * `--append-system-prompt` flags.
   */
  readonly appendSystemPrompt?: readonly string[];
  /**
   * Optional additional extension sources passed as repeated `--extension`
   * flags.
   */
  readonly extensions?: readonly string[];
  /**
   * Optional additional prompt-template sources passed as repeated
   * `--prompt-template` flags.
   */
  readonly promptTemplates?: readonly string[];
  /**
   * Environment variables forwarded to the Pi subprocess.
   */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Partial Pi subprocess configuration accepted from callers and config files.
 *
 * @remarks
 * This is the library-facing input shape. `PiWs` resolves it into a full
 * `PiProcessConfig` by applying defaults such as inheriting the current
 * process environment and using an empty extra-args list.
 *
 * @public
 */
export interface PiProcessOptions {
  /**
   * Explicit command to spawn instead of the bundled Pi CLI.
   */
  readonly command?: string;
  /**
   * Additional raw arguments passed to the Pi CLI process.
   */
  readonly args?: readonly string[];
  /**
   * Optional working directory for the Pi subprocess.
   */
  readonly cwd?: string;
  /**
   * Optional override for Pi's agent directory.
   */
  readonly agentDir?: string;
  /**
   * Optional Pi provider name, such as `openai` or `anthropic`.
   */
  readonly provider?: string;
  /**
   * Optional Pi model pattern or full model ID.
   */
  readonly model?: string;
  /**
   * Optional Pi thinking level.
   */
  readonly thinking?: string;
  /**
   * Optional Pi session display name.
   */
  readonly sessionName?: string;
  /**
   * Optional system prompt replacement passed as `--system-prompt`.
   */
  readonly systemPrompt?: string;
  /**
   * Optional extra system prompt snippets passed as repeated
   * `--append-system-prompt` flags.
   */
  readonly appendSystemPrompt?: readonly string[];
  /**
   * Optional additional extension sources passed as repeated `--extension`
   * flags.
   */
  readonly extensions?: readonly string[];
  /**
   * Optional additional prompt-template sources passed as repeated
   * `--prompt-template` flags.
   */
  readonly promptTemplates?: readonly string[];
  /**
   * Environment variables forwarded to the Pi subprocess.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Generated artifact transfer settings for the built-in Pi WebSocket route.
 *
 * @remarks
 * When enabled, `pi-ws` creates a per-connection artifact directory, tells Pi
 * to write generated files there, and forwards stable files to the websocket
 * client as metadata text frames plus binary frames.
 *
 * @public
 */
export interface PiWsArtifactConfig {
  /**
   * Enables artifact discovery and websocket transfer.
   */
  readonly enabled: boolean;
  /**
   * Root directory that stores per-connection artifact subdirectories.
   */
  readonly dir: string;
  /**
   * Maximum file size accepted for websocket transfer.
   */
  readonly maxFileBytes: number;
  /**
   * Binary chunk size used when a file is transferred in multiple frames.
   */
  readonly chunkSizeBytes: number;
  /**
   * Poll interval for discovering newly created files.
   */
  readonly scanIntervalMs: number;
  /**
   * Minimum unchanged time before a discovered file is considered complete.
   */
  readonly stabilityWindowMs: number;
  /**
   * Pino log level used for artifact and sandbox diagnostics.
   *
   * @defaultValue `"silent"`
   */
  readonly logLevel: LevelWithSilent;
  /**
   * Optional pino log destination file path.
   */
  readonly logFile?: string;
}

/**
 * Partial artifact configuration accepted from callers and config files.
 *
 * @public
 */
export interface PiWsArtifactOptions {
  /**
   * Enables artifact discovery and websocket transfer.
   */
  readonly enabled?: boolean;
  /**
   * Root directory that stores per-connection artifact subdirectories.
   */
  readonly dir?: string;
  /**
   * Maximum file size accepted for websocket transfer.
   */
  readonly maxFileBytes?: number;
  /**
   * Binary chunk size used when a file is transferred in multiple frames.
   */
  readonly chunkSizeBytes?: number;
  /**
   * Poll interval for discovering newly created files.
   */
  readonly scanIntervalMs?: number;
  /**
   * Minimum unchanged time before a discovered file is considered complete.
   */
  readonly stabilityWindowMs?: number;
  /**
   * Pino log level used for artifact and sandbox diagnostics.
   */
  readonly logLevel?: LevelWithSilent;
  /**
   * Optional pino log destination file path.
   */
  readonly logFile?: string;
}

/**
 * Supported Pi sandbox modes.
 *
 * @remarks
 * `process` isolates cwd and environment only. `system` delegates process
 * isolation to an external wrapper command such as `bwrap` or `firejail`.
 *
 * @public
 */
export type PiWsSandboxMode = 'off' | 'process' | 'system';

/**
 * Environment inheritance policy for the Pi subprocess.
 *
 * @public
 */
export type PiWsSandboxEnvPolicy = 'inherit' | 'minimal' | 'allowlist';

/**
 * Pi subprocess isolation settings.
 *
 * @remarks
 * `process` mode does not enforce filesystem access restrictions by itself.
 * It only isolates cwd, HOME, TMPDIR, and the forwarded environment. Use
 * `system` mode with an external wrapper command when you need OS-enforced
 * directory isolation.
 *
 * @public
 */
export interface PiWsSandboxConfig {
  /**
   * Sandbox strategy for spawned Pi subprocesses.
   */
  readonly mode: PiWsSandboxMode;
  /**
   * Root directory that stores per-connection sandbox work directories.
   */
  readonly cwd: string;
  /**
   * Read-only directory allowlist communicated to Pi and wrapper commands.
   */
  readonly allowReadDirs: readonly string[];
  /**
   * Writable directory allowlist communicated to Pi and wrapper commands.
   */
  readonly allowWriteDirs: readonly string[];
  /**
   * Policy used to build the spawned Pi process environment.
   */
  readonly envPolicy: PiWsSandboxEnvPolicy;
  /**
   * Environment variable names copied from the configured Pi environment when
   * `envPolicy` is `"allowlist"` or to augment `"minimal"`.
   */
  readonly envAllowlist: readonly string[];
  /**
   * Extra environment variables injected after the base environment is built.
   */
  readonly env: Readonly<Record<string, string>>;
  /**
   * Rejects sandbox cwd values that point into the current server workspace.
   */
  readonly denyServerDirectory: boolean;
  /**
   * Optional external sandbox wrapper command for `system` mode.
   */
  readonly command?: string;
  /**
   * Optional external sandbox wrapper arguments for `system` mode.
   *
   * @remarks
   * `pi-ws` appends the resolved Pi command and arguments after these values.
   * Supported placeholders include `{artifactDir}`, `{sandboxCwd}`,
   * `{sandboxHome}`, and `{sessionRoot}`.
   */
  readonly args: readonly string[];
}

/**
 * Partial Pi sandbox configuration accepted from callers and config files.
 *
 * @public
 */
export interface PiWsSandboxOptions {
  /**
   * Sandbox strategy for spawned Pi subprocesses.
   */
  readonly mode?: PiWsSandboxMode;
  /**
   * Root directory that stores per-connection sandbox work directories.
   */
  readonly cwd?: string;
  /**
   * Read-only directory allowlist communicated to Pi and wrapper commands.
   */
  readonly allowReadDirs?: readonly string[];
  /**
   * Writable directory allowlist communicated to Pi and wrapper commands.
   */
  readonly allowWriteDirs?: readonly string[];
  /**
   * Policy used to build the spawned Pi process environment.
   */
  readonly envPolicy?: PiWsSandboxEnvPolicy;
  /**
   * Environment variable names copied from the configured Pi environment when
   * `envPolicy` is `"allowlist"` or to augment `"minimal"`.
   */
  readonly envAllowlist?: readonly string[];
  /**
   * Extra environment variables injected after the base environment is built.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Rejects sandbox cwd values that point into the current server workspace.
   */
  readonly denyServerDirectory?: boolean;
  /**
   * Optional external sandbox wrapper command for `system` mode.
   */
  readonly command?: string;
  /**
   * Optional external sandbox wrapper arguments for `system` mode.
   */
  readonly args?: readonly string[];
}

/**
 * Runtime configuration for a `PiWs` instance.
 *
 * @remarks
 * This is the fully-resolved runtime form produced by `createDefaultConfig()`
 * or the async `loadConfig()` helper.
 *
 * @public
 */
export interface PiWsConfig<Session = unknown> {
  /**
   * Host or IP address to bind the HTTP/WebSocket server to.
   *
   * @defaultValue `"127.0.0.1"` in the resolved runtime config
   */
  readonly host: string;
  /**
   * TCP port to listen on.
   *
   * @defaultValue `8787` in the resolved runtime config
   */
  readonly port: number;
  /**
   * Prefix reserved for built-in WebSocket routes such as `/ws/pi`.
   *
   * @defaultValue `"/ws"` in the resolved runtime config
   */
  readonly wsPrefix: string;
  /**
   * Maximum accepted inbound WebSocket frame size in bytes.
   *
   * @defaultValue `1048576` in the resolved runtime config
   */
  readonly maxPayloadBytes: number;
  /**
   * Optional TLS settings. When provided, `pi-ws` starts an SSL app and serves
   * HTTPS / WSS instead of plain HTTP / WS.
   */
  readonly tls?: PiWsTlsConfig;
  /**
   * Pi subprocess launch configuration.
   */
  readonly pi: PiProcessConfig;
  /**
   * Generated artifact discovery and websocket transfer settings.
   */
  readonly artifacts: PiWsArtifactConfig;
  /**
   * Pi subprocess isolation settings.
   */
  readonly sandbox: PiWsSandboxConfig;
  /**
   * Optional hooks for the built-in Pi WebSocket route at
   * `${wsPrefix}/pi`.
   *
   * @remarks
   * This protects the default Pi bridge route only. Use `protectHttpHandler()`
   * or `protectWebSocketBehavior()` for your own custom routes.
   */
  readonly piHooks?: PiWsHooks<Session>;
  /**
   * Enables serving the built-in browser chat example routes.
   *
   * @defaultValue `true` in the resolved runtime config
   */
  readonly chatExample: boolean;
}

/**
 * Partial server configuration accepted from callers and config files.
 *
 * @remarks
 * This is the public input shape used by `new PiWs()`, `configure()`, and the
 * async `loadConfig()` helper. It keeps nested objects optional so the package
 * can be used as a composable building block instead of requiring callers to
 * provide the fully-resolved runtime config up front.
 *
 * @public
 */
export interface PiWsOptions<Session = unknown> {
  /**
   * Host or IP address to bind the HTTP/WebSocket server to.
   */
  readonly host?: string;
  /**
   * TCP port to listen on.
   */
  readonly port?: number;
  /**
   * Prefix reserved for built-in WebSocket routes such as `/ws/pi`.
   */
  readonly wsPrefix?: string;
  /**
   * Maximum accepted inbound WebSocket frame size in bytes.
   */
  readonly maxPayloadBytes?: number;
  /**
   * Optional TLS settings. When provided, `pi-ws` starts an SSL app and serves
   * HTTPS / WSS instead of plain HTTP / WS.
   */
  readonly tls?: PiWsTlsConfig;
  /**
   * Pi subprocess launch settings.
   */
  readonly pi?: PiProcessOptions;
  /**
   * Generated artifact discovery and websocket transfer settings.
   */
  readonly artifacts?: PiWsArtifactOptions;
  /**
   * Pi subprocess isolation settings.
   */
  readonly sandbox?: PiWsSandboxOptions;
  /**
   * Optional hooks for the built-in Pi WebSocket route.
   */
  readonly piHooks?: PiWsHooks<Session>;
  /**
   * Enables serving the built-in browser chat example routes.
   */
  readonly chatExample?: boolean;
}

/**
 * Supported `uWebSockets.js` HTTP route methods.
 *
 * @public
 */
export type HttpMethod =
  | 'get'
  | 'post'
  | 'options'
  | 'del'
  | 'patch'
  | 'put'
  | 'head'
  | 'connect'
  | 'trace'
  | 'any';

/**
 * HTTP route handler callback.
 *
 * @remarks
 * The callback receives the native `uWebSockets.js` response and request
 * objects. `pi-ws` does not wrap them.
 *
 * @public
 */
export type HttpHandler = (res: HttpResponse, req: HttpRequest) => void;

/**
 * Declarative HTTP route registration.
 *
 * @public
 */
export interface HttpRoute {
  /**
   * HTTP method to register.
   */
  readonly method: HttpMethod;
  /**
   * Route path pattern.
   */
  readonly path: string;
  /**
   * Request handler callback.
   */
  readonly handler: HttpHandler;
}

/**
 * Declarative WebSocket route registration.
 *
 * @typeParam UserData - `uWebSockets.js` per-socket user data type.
 * @public
 */
export interface WebSocketRoute<UserData = unknown> {
  /**
   * WebSocket route path.
   */
  readonly path: string;
  /**
   * `uWebSockets.js` behavior object for the route.
   */
  readonly behavior: WebSocketBehavior<UserData>;
}

/**
 * Imperative installer for direct `uWebSockets.js` access.
 *
 * @public
 */
export interface RouteInstaller {
  /**
   * Applies custom route or app-level registrations to the server app.
   */
  install(app: TemplatedApp): void;
}

/**
 * Running server handle returned by `PiWs.listen()`.
 *
 * @public
 */
export interface RunningServer {
  /**
   * Actual port the server is listening on.
   */
  readonly port: number;
  /**
   * Stops the listening socket and closes the underlying app.
   */
  close(): void;
}

/**
 * Optional per-listen overrides for host and port.
 *
 * @public
 */
export interface PiWsListenOptions {
  /**
   * Optional host override for this listen call.
   */
  readonly host?: string;
  /**
   * Optional port override for this listen call.
   */
  readonly port?: number;
}
