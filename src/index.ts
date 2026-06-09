/**
 * Library-first entrypoint for pi-ws.
 *
 * Use `new PiWs()` to embed the server programmatically, or use the
 * `pi-ws` binary for the default as-is server.
 *
 * @packageDocumentation
 */

export {
  composeAuthorizers,
  createStaticTokenAuthorizer,
  protectHttpHandler,
  protectWebSocketBehavior,
} from './server/auth.js';
export {
  createDefaultConfig,
  definePiWsConfig,
  loadConfig,
} from './server/config.js';
export type { PiWsConfigLoaderOptions } from './server/config.js';
export { createPiWsServer, PiWs } from './server/server.js';
export type {
  AuthorizationFailure,
  AuthorizationRequest,
  AuthorizationResult,
  AuthorizationSuccess,
  HttpHandler,
  HttpMethod,
  HttpRoute,
  PiProcessOptions,
  PiWsTlsConfig,
  PiWsConfig,
  PiWsListenOptions,
  PiWsOptions,
  PiProcessConfig,
  RequestAuthorizer,
  RouteInstaller,
  RunningServer,
  WebSocketRoute,
} from './server/types.js';
