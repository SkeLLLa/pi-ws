/**
 * Library-first entrypoint for pi-ws.
 *
 * Use `new PiWs()` to embed the server programmatically, or use the
 * `pi-ws` binary for the default as-is server.
 *
 * @packageDocumentation
 */

export { loadConfig } from './server/config.js';
export { createPiWsServer, PiWs } from './server/server.js';
export type {
  HttpHandler,
  HttpMethod,
  HttpRoute,
  PiWsConfig,
  PiWsListenOptions,
  PiProcessConfig,
  RouteInstaller,
  RunningServer,
  WebSocketRoute,
} from './server/types.js';
