import {
  App,
  us_listen_socket_close,
  type TemplatedApp,
  type us_listen_socket,
} from 'uWebSockets.js';
import { createPiWebSocketRoute } from '../ws/pi-route.js';
import { loadConfig } from './config.js';
import { installChatExampleRoutes } from './static.js';
import type {
  HttpHandler,
  HttpMethod,
  HttpRoute,
  PiWsConfig,
  PiWsListenOptions,
  RouteInstaller,
  RunningServer,
  WebSocketRoute,
} from './types.js';

const createUwsApp = App;

/**
 * Library-first wrapper around `uWebSockets.js` that exposes a built-in Pi RPC
 * route and lets callers add their own HTTP and WebSocket handlers.
 *
 * @remarks
 * `PiWs` always reserves the built-in Pi RPC route at `${wsPrefix}/pi`.
 * Additional HTTP handlers can be attached with `handle()`, additional
 * WebSocket endpoints can be attached with `route()`, and advanced direct
 * `uWebSockets.js` customization can be attached with `use()`.
 *
 * @public
 */
export class PiWs {
  readonly #config: PiWsConfig;
  readonly #httpRoutes: HttpRoute[] = [];
  readonly #wsRoutes: WebSocketRoute[] = [];
  readonly #installers: RouteInstaller[] = [];

  #server: RunningServer | undefined;

  /**
   * Creates a new `PiWs` instance.
   *
   * @remarks
   * The provided config is merged over `loadConfig(process.env)`. This makes
   * the constructor convenient for both embedded usage and CLI-style startup.
   *
   * @param config - Optional partial configuration merged over environment defaults.
   */
  constructor(config: Partial<PiWsConfig> = {}) {
    this.#config = mergeConfig(loadConfig(process.env), config);
  }

  /**
   * Registers an HTTP route on the underlying `uWebSockets.js` app.
   *
   * @remarks
   * Routes added here are installed after the built-in `/healthz` route and
   * before the final catch-all 404 handler.
   *
   * @param method - HTTP method name as expected by `uWebSockets.js`.
   * @param path - Route path pattern.
   * @param handler - Route callback.
   * @returns The current `PiWs` instance.
   */
  handle(method: HttpMethod, path: string, handler: HttpHandler): this {
    this.#httpRoutes.push({ method, path, handler });
    return this;
  }

  /**
   * Registers a WebSocket route on the underlying `uWebSockets.js` app.
   *
   * @remarks
   * The built-in Pi route at `${wsPrefix}/pi` is always registered separately.
   * Use this method for any additional WebSocket endpoints your application needs.
   *
   * @typeParam UserData - `uWebSockets.js` per-socket user data type.
   * @param path - WebSocket route path.
   * @param behavior - Route behavior passed to `app.ws()`.
   * @returns The current `PiWs` instance.
   */
  route<UserData = unknown>(
    path: string,
    behavior: WebSocketRoute<UserData>['behavior'],
  ): this {
    this.#wsRoutes.push({
      path,
      behavior: behavior as WebSocketRoute['behavior'],
    });
    return this;
  }

  /**
   * Installs custom routes or behaviors using direct `uWebSockets.js` access.
   *
   * @remarks
   * This is the escape hatch for advanced integration cases where `handle()`
   * or `route()` are not enough.
   *
   * @param installer - Installer object or callback.
   * @returns The current `PiWs` instance.
   */
  use(installer: RouteInstaller | ((app: TemplatedApp) => void)): this {
    this.#installers.push(
      typeof installer === 'function' ? { install: installer } : installer,
    );
    return this;
  }

  /**
   * Starts listening and returns a handle for the running server.
   *
   * @remarks
   * Repeated calls return the same running server instance until `close()` is
   * called.
   *
   * @param options - Optional host or port overrides for this listen call.
   * @returns Running server handle.
   */
  async listen(options: PiWsListenOptions = {}): Promise<RunningServer> {
    if (this.#server !== undefined) return this.#server;

    const config = mergeConfig(this.#config, options);
    const app = this.createApp();

    this.#server = await listen(app, config.host, config.port);
    return this.#server;
  }

  /**
   * Stops the currently running server, if any.
   *
   * @remarks
   * Calling `close()` is idempotent.
   */
  close(): void {
    this.#server?.close();
    this.#server = undefined;
  }

  /**
   * Builds a configured `uWebSockets.js` application without starting it.
   *
   * @remarks
   * This is mainly useful when another part of your program needs access to the
   * configured app instance before binding a socket.
   *
   * @returns Configured app instance.
   */
  createApp(): TemplatedApp {
    const app = createUwsApp();

    installHealthRoute(app);
    if (this.#config.chatExample) {
      installChatExampleRoutes(app);
    }

    app.ws(
      `${this.#config.wsPrefix}/pi`,
      createPiWebSocketRoute({
        pi: this.#config.pi,
        maxPayloadBytes: this.#config.maxPayloadBytes,
      }),
    );

    for (const route of this.#httpRoutes) {
      app[route.method](route.path, route.handler);
    }

    for (const route of this.#wsRoutes) {
      app.ws(route.path, route.behavior);
    }

    for (const installer of this.#installers) {
      installer.install(app);
    }

    installNotFoundRoute(app);
    return app;
  }
}

/**
 * Convenience factory that creates a `PiWs`, installs routes, and starts listening.
 *
 * @remarks
 * Prefer `new PiWs()` when you want to keep a reusable instance around.
 * This helper is useful when a one-shot startup function is enough.
 *
 * @param config - Full server configuration.
 * @param installers - Optional route installers applied before listening.
 * @returns Running server handle.
 * @public
 */
export async function createPiWsServer(
  config: PiWsConfig,
  installers: readonly RouteInstaller[] = [],
): Promise<RunningServer> {
  const pipe = new PiWs(config);

  for (const installer of installers) {
    pipe.use(installer);
  }

  return pipe.listen();
}

function mergeConfig(
  base: PiWsConfig,
  override: Partial<PiWsConfig>,
): PiWsConfig {
  return {
    ...base,
    ...override,
    pi: {
      ...base.pi,
      ...override.pi,
    },
  };
}

function installHealthRoute(app: TemplatedApp): void {
  app.get('/healthz', (res) => {
    res
      .writeHeader('content-type', 'application/json')
      .end(JSON.stringify({ ok: true }));
  });
}

function installNotFoundRoute(app: TemplatedApp): void {
  app.any('/*', (res) => {
    res
      .writeStatus('404 Not Found')
      .writeHeader('content-type', 'application/json')
      .end(JSON.stringify({ error: 'not_found' }));
  });
}

function listen(
  app: TemplatedApp,
  host: string,
  port: number,
): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    app.listen(host, port, (socket) => {
      if (socket === false) {
        reject(new Error(`Failed to listen on ${host}:${String(port)}`));
        return;
      }

      resolve(createRunningServer(app, socket, port));
    });
  });
}

function createRunningServer(
  app: TemplatedApp,
  socket: us_listen_socket,
  port: number,
): RunningServer {
  let closed = false;

  return {
    port,
    close() {
      if (closed) return;
      closed = true;
      us_listen_socket_close(socket);
      app.close();
    },
  };
}
