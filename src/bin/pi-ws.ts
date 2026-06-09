#!/usr/bin/env node
import { loadConfig, PiWs } from '../index.js';
import { createPiWsLogger } from '../server/logger.js';

const config = await loadConfig({
  env: process.env,
});
const logger = createPiWsLogger(config.artifacts).child({ component: 'cli' });
const pipe = new PiWs(config);
const server = await pipe.listen();
const resolved = pipe.getConfig();
const protocol = resolved.tls === undefined ? 'ws' : 'wss';

logger.info(
  {
    url: `${protocol}://${resolved.host}:${String(server.port)}${resolved.wsPrefix}/pi`,
  },
  'pi-ws listening',
);

const stop = (): void => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
