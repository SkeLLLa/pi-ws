#!/usr/bin/env node
import { loadConfig, PiPipe } from '../index.js';

const config = loadConfig(process.env);
const pipe = new PiPipe(config);
const server = await pipe.listen();

console.log(
  `pi-pipe: listening on ws://${config.host}:${String(server.port)}${config.wsPrefix}/pi`,
);

const stop = (): void => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
