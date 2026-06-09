import {
  App,
  SSLApp,
  us_listen_socket_close,
  type AppOptions,
  type TemplatedApp,
  type us_listen_socket,
} from 'uWebSockets.js';
import { createArtifactLogger } from '../artifacts/logger.js';
import { createPiWebSocketRoute } from '../ws/pi-route.js';
import { createDefaultConfig } from './config.js';
import { ChatExampleRoutes } from './static.js';
import type {
  AuthHook,
  HttpHandler,
  HttpMethod,
  HttpRoute,
  PiProcessOptions,
  PiWsArtifactOptions,
  PiWsConfig,
  PiWsHookName,
  PiWsListenOptions,
  PiWsOptions,
  PiWsSandboxOptions,
  RequestHook,
  RouteInstaller,
  RunningServer,
  WebSocketRoute,
} from './types.js';

const createPlainApp = App;
const createSecureApp = SSLApp;

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
export class PiWs<Session = unknown> {
  #config: PiWsConfig<Session>;
  readonly #httpRoutes: HttpRoute[] = [];
  readonly #wsRoutes: WebSocketRoute[] = [];
  readonly #installers: RouteInstaller[] = [];

  #server: RunningServer | undefined;

  /**
   * Creates a new `PiWs` instance.
   *
   * @remarks
   * The constructor applies the provided partial options over built-in
   * defaults. Use the async `loadConfig()` helper when you want file and
   * environment-based configuration loading via c12.
   *
   * @param config - Optional partial configuration merged over library defaults.
   */
  constructor(config: PiWsOptions<Session> = {}) {
    this.#config = mergeConfig<Session>({
      base: createDefaultConfig(process.env) as PiWsConfig<Session>,
      override: config,
    });
  }

  /**
   * Returns the current resolved server configuration.
   *
   * @remarks
   * The returned object is a snapshot of the configuration after applying
   * environment defaults, constructor options, and any subsequent chainable
   * configuration calls.
   *
   * @returns Current server configuration snapshot.
   */
  getConfig(): Readonly<PiWsConfig<Session>> {
    return this.#config;
  }

  /**
   * Merges additional server configuration into the current instance.
   *
   * @remarks
   * This is the main library-first configuration entrypoint when you want to
   * build a server incrementally instead of passing all options to the
   * constructor.
   *
   * @param config - Partial configuration to merge.
   * @returns The current `PiWs` instance.
   */
  configure(config: PiWsOptions<Session>): this {
    this.#config = mergeConfig<Session>({
      base: this.#config,
      override: config,
    });
    return this;
  }

  /**
   * Merges additional Pi subprocess settings into the current instance.
   *
   * @param config - Partial Pi process configuration to merge.
   * @returns The current `PiWs` instance.
   */
  configurePi(config: PiProcessOptions): this {
    this.#config = {
      ...this.#config,
      pi: {
        ...this.#config.pi,
        ...config,
      },
    };
    return this;
  }

  /**
   * Merges generated artifact transfer settings into the current instance.
   *
   * @param config - Partial artifact configuration to merge.
   * @returns The current `PiWs` instance.
   */
  configureArtifacts(config: PiWsArtifactOptions): this {
    this.#config = {
      ...this.#config,
      artifacts: {
        ...this.#config.artifacts,
        ...config,
      },
    };
    return this;
  }

  /**
   * Merges Pi sandbox settings into the current instance.
   *
   * @param config - Partial sandbox configuration to merge.
   * @returns The current `PiWs` instance.
   */
  configureSandbox(config: PiWsSandboxOptions): this {
    this.#config = {
      ...this.#config,
      sandbox: {
        ...this.#config.sandbox,
        ...config,
      },
    };
    return this;
  }

  /**
   * Enables HTTPS / WSS by applying TLS settings to the server.
   *
   * @param config - TLS certificate and key settings.
   * @returns The current `PiWs` instance.
   */
  configureTls(config: PiWsConfig['tls']): this {
    if (config === undefined) {
      throw new Error('TLS config is required');
    }

    this.#config = mergeConfig<Session>({
      base: this.#config,
      override: { tls: config },
    });
    return this;
  }

  /**
   * Disables HTTPS / WSS and returns the server to plain HTTP / WS mode.
   *
   * @returns The current `PiWs` instance.
   */
  disableTls(): this {
    this.#config = clearTlsConfig<Session>(this.#config);
    return this;
  }

  /**
   * Enables or disables the built-in browser chat example routes.
   *
   * @param enabled - Whether to serve the example.
   * @returns The current `PiWs` instance.
   */
  setChatExample(enabled: boolean): this {
    this.#config = mergeConfig<Session>({
      base: this.#config,
      override: { chatExample: enabled },
    });
    return this;
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
  handle({
    method,
    path,
    handler,
  }: {
    method: HttpMethod;
    path: string;
    handler: HttpHandler;
  }): this {
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
  route<UserData = unknown>({
    path,
    behavior,
  }: {
    path: string;
    behavior: WebSocketRoute<UserData>['behavior'];
  }): this {
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
   * Registers a built-in Pi route hook.
   *
   * @remarks
   * This mirrors the Fastify-style `addHook(name, fn)` shape for built-in Pi
   * route lifecycles.
   *
   * @param name - Hook lifecycle name.
   * @param hook - Hook callback.
   * @returns The current `PiWs` instance.
   */
  addHook(name: 'onRequest', hook: RequestHook<Session>): this;
  addHook(name: 'onAuth', hook: AuthHook<Session>): this;
  addHook(
    name: PiWsHookName,
    hook: RequestHook<Session> | AuthHook<Session>,
  ): this {
    if (name === 'onRequest') {
      this.#config = {
        ...this.#config,
        piHooks: {
          ...this.#config.piHooks,
          onRequest: [
            ...(this.#config.piHooks?.onRequest ?? []),
            hook as RequestHook<Session>,
          ],
        },
      };
      return this;
    }

    this.#config = {
      ...this.#config,
      piHooks: {
        ...this.#config.piHooks,
        onAuth: [
          ...(this.#config.piHooks?.onAuth ?? []),
          hook as AuthHook<Session>,
        ],
      },
    };
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

    const app = this.createApp();
    const config = {
      host: options.host ?? this.#config.host,
      port: options.port ?? this.#config.port,
    };

    this.#server = await listen({ app, host: config.host, port: config.port });
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
    const app = createUwsApp(this.#config);

    installHealthRoute(app);
    if (this.#config.chatExample) {
      new ChatExampleRoutes().install({ app });
    }

    app.ws(
      `${this.#config.wsPrefix}/pi`,
      createPiWebSocketRoute<Session>({
        artifacts: this.#config.artifacts,
        logger: createArtifactLogger(this.#config.artifacts),
        pi: this.#config.pi,
        maxPayloadBytes: this.#config.maxPayloadBytes,
        sandbox: this.#config.sandbox,
        ...(this.#config.piHooks === undefined
          ? {}
          : { hooks: this.#config.piHooks }),
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
 * @param config - Partial server options merged over built-in defaults.
 * @param installers - Optional route installers applied before listening.
 * @returns Running server handle.
 * @public
 */
export async function createPiWsServer<Session = unknown>({
  config,
  installers = [],
}: {
  config: PiWsOptions<Session>;
  installers?: readonly RouteInstaller[];
}): Promise<RunningServer> {
  const pipe = new PiWs<Session>(config);

  for (const installer of installers) {
    pipe.use(installer);
  }

  return pipe.listen();
}

function mergeConfig<Session>({
  base,
  override,
}: {
  base: PiWsConfig<Session>;
  override: PiWsOptions<Session>;
}): PiWsConfig<Session> {
  const tls = mergeTlsConfig({ base: base.tls, override: override.tls });

  return {
    ...base,
    ...override,
    artifacts: {
      ...base.artifacts,
      ...override.artifacts,
    },
    pi: {
      ...base.pi,
      ...override.pi,
    },
    sandbox: {
      ...base.sandbox,
      ...override.sandbox,
    },
    ...(tls === undefined ? {} : { tls }),
  };
}

function clearTlsConfig<Session>(
  config: PiWsConfig<Session>,
): PiWsConfig<Session> {
  const { tls: _tls, ...rest } = config;
  void _tls;
  return rest;
}

function mergeTlsConfig({
  base,
  override,
}: {
  base: PiWsConfig['tls'];
  override: PiWsConfig['tls'];
}): PiWsConfig['tls'] {
  if (override === undefined) return base;
  if (base === undefined) return override;

  return {
    keyFileName: override.keyFileName,
    certFileName: override.certFileName,
    ...((override.caFileName ?? base.caFileName) === undefined
      ? {}
      : {
          caFileName: override.caFileName ?? base.caFileName,
        }),
    ...((override.passphrase ?? base.passphrase) === undefined
      ? {}
      : {
          passphrase: override.passphrase ?? base.passphrase,
        }),
    ...((override.dhParamsFileName ?? base.dhParamsFileName) === undefined
      ? {}
      : {
          dhParamsFileName: override.dhParamsFileName ?? base.dhParamsFileName,
        }),
    ...((override.sslCiphers ?? base.sslCiphers) === undefined
      ? {}
      : {
          sslCiphers: override.sslCiphers ?? base.sslCiphers,
        }),
    ...((override.preferLowMemoryUsage ?? base.preferLowMemoryUsage) ===
    undefined
      ? {}
      : {
          preferLowMemoryUsage:
            override.preferLowMemoryUsage ?? base.preferLowMemoryUsage,
        }),
  };
}

function createUwsApp<Session>(config: PiWsConfig<Session>): TemplatedApp {
  if (config.tls === undefined) {
    return createPlainApp();
  }

  return createSecureApp(toUwsTlsOptions(config.tls));
}

function toUwsTlsOptions(config: PiWsConfig['tls']): AppOptions {
  if (config === undefined) {
    throw new Error('TLS config is required to build an SSL app');
  }

  return {
    key_file_name: config.keyFileName,
    cert_file_name: config.certFileName,
    ...(config.caFileName === undefined
      ? {}
      : { ca_file_name: config.caFileName }),
    ...(config.passphrase === undefined
      ? {}
      : { passphrase: config.passphrase }),
    ...(config.dhParamsFileName === undefined
      ? {}
      : { dh_params_file_name: config.dhParamsFileName }),
    ...(config.sslCiphers === undefined
      ? {}
      : { ssl_ciphers: config.sslCiphers }),
    ...(config.preferLowMemoryUsage === undefined
      ? {}
      : {
          ssl_prefer_low_memory_usage: config.preferLowMemoryUsage,
        }),
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

function listen({
  app,
  host,
  port,
}: {
  app: TemplatedApp;
  host: string;
  port: number;
}): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    app.listen(host, port, (socket) => {
      if (socket === false) {
        reject(new Error(`Failed to listen on ${host}:${String(port)}`));
        return;
      }

      resolve(createRunningServer({ app, socket, port }));
    });
  });
}

function createRunningServer({
  app,
  socket,
  port,
}: {
  app: TemplatedApp;
  socket: us_listen_socket;
  port: number;
}): RunningServer {
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
