import type {
  HttpRequest,
  HttpResponse,
  TemplatedApp,
  WebSocketBehavior,
} from 'uWebSockets.js';

/**
 * Process launch settings for the local Pi RPC subprocess.
 *
 * @remarks
 * These settings are passed to the child process that runs Pi in RPC mode.
 * By default, `loadConfig()` uses the bundled Pi CLI and prepends `--mode rpc`
 * to the configured argument list.
 *
 * @public
 */
export interface PiProcessConfig {
  /**
   * Explicit command to spawn instead of the bundled Pi CLI.
   */
  readonly command?: string;
  /**
   * Arguments passed to the Pi CLI process.
   */
  readonly args: readonly string[];
  /**
   * Optional working directory for the Pi subprocess.
   */
  readonly cwd?: string;
  /**
   * Environment variables forwarded to the Pi subprocess.
   */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Runtime configuration for a `PiWs` instance.
 *
 * @remarks
 * `new PiWs()` merges the provided partial config over the defaults returned
 * by `loadConfig(process.env)`.
 *
 * @public
 */
export interface PiWsConfig {
  /**
   * Host or IP address to bind the HTTP/WebSocket server to.
   *
   * @defaultValue `"0.0.0.0"` when loaded via `loadConfig()`
   */
  readonly host: string;
  /**
   * TCP port to listen on.
   *
   * @defaultValue `8787` when loaded via `loadConfig()`
   */
  readonly port: number;
  /**
   * Prefix reserved for built-in WebSocket routes such as `/ws/pi`.
   *
   * @defaultValue `"/ws"` when loaded via `loadConfig()`
   */
  readonly wsPrefix: string;
  /**
   * Maximum accepted inbound WebSocket frame size in bytes.
   *
   * @defaultValue `1048576` when loaded via `loadConfig()`
   */
  readonly maxPayloadBytes: number;
  /**
   * Pi subprocess launch configuration.
   */
  readonly pi: PiProcessConfig;
  /**
   * Enables serving the built-in browser chat example routes.
   *
   * @defaultValue `true` when loaded via `loadConfig()`
   */
  readonly chatExample: boolean;
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
