#!/usr/bin/env node
import { loadConfig, PiWs } from '../index.js';

const config = await loadConfig({
  env: process.env,
});
const pipe = new PiWs(config);
const server = await pipe.listen();
const resolved = pipe.getConfig();
const protocol = resolved.tls === undefined ? 'ws' : 'wss';

console.log(
  `pi-ws: listening on ${protocol}://${resolved.host}:${String(server.port)}${resolved.wsPrefix}/pi`,
);

const stop = (): void => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
