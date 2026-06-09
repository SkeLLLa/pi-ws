/**
 * Library-first entrypoint for pi-ws.
 *
 * Use `new PiPipe()` to embed the server programmatically, or use the
 * `pi-ws` binary for the default as-is server.
 *
 * @packageDocumentation
 */

export { loadConfig } from './server/config.js';
export { createPiPipeServer, PiPipe } from './server/server.js';
export type {
  HttpHandler,
  HttpMethod,
  HttpRoute,
  PiPipeConfig,
  PiPipeListenOptions,
  PiProcessConfig,
  RouteInstaller,
  RunningServer,
  WebSocketRoute,
} from './server/types.js';
