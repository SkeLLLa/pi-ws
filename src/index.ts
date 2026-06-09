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
  composeHooks,
  createStaticTokenAuthHook,
  getWebSocketContext,
  getWebSocketSession,
  protectHttpHandler,
  protectWebSocketBehavior,
  StaticTokenAuthorizer,
} from './server/auth.js';
export type {
  StaticTokenAuthHookOptions,
  StaticTokenAuthorizerOptions,
} from './server/auth.js';
export {
  createDefaultConfig,
  definePiWsConfig,
  loadConfig,
} from './server/config.js';
export type { PiWsConfigLoaderOptions } from './server/config.js';
export { createPiWsServer, PiWs } from './server/server.js';
export type {
  AuthHook,
  AuthHookInput,
  AuthSource,
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
  PiWsHookName,
  PiWsHooks,
  PiWsListenOptions,
  PiWsOptions,
  PiProcessConfig,
  RequestHook,
  RequestHookContext,
  RequestHookResult,
  RequestHookSuccess,
  RequestAuthorizer,
  RouteInstaller,
  RunningServer,
  WebSocketRoute,
  WebSocketConnectionContext,
} from './server/types.js';
