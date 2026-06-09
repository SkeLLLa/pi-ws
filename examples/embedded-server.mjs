import { resolve } from 'node:path';
import {
  createStaticTokenAuthHook,
  PiWs,
  protectHttpHandler,
  StaticTokenAuthorizer,
} from '../dist/index.js';
import { createExampleLogger } from './logger.mjs';

const authToken = process.env.PI_WS_AUTH_TOKEN;
const authQueryParam = process.env.PI_WS_AUTH_QUERY_PARAM ?? 'token';
const root = resolve(import.meta.dirname, '..');
const logger = createExampleLogger('pi-ws-embedded-example');
const artifactDir =
  process.env.PI_WS_ARTIFACTS_DIR ??
  resolve(root, '.tmp/pi-ws-example/artifacts');
const artifactLogFile =
  process.env.PI_WS_ARTIFACTS_LOG_FILE ??
  resolve(root, '.tmp/pi-ws-example/pi-ws.log');
const sandboxDir =
  process.env.PI_WS_SANDBOX_CWD ?? resolve(root, '.tmp/pi-ws-example/sandbox');

const pipe = new PiWs({
  artifacts: {
    dir: artifactDir,
    logFile: artifactLogFile,
    logLevel: process.env.PI_WS_ARTIFACTS_LOG_LEVEL ?? 'info',
  },
  host: '127.0.0.1',
  port: 8787,
  sandbox: {
    cwd: sandboxDir,
    denyServerDirectory: true,
    envPolicy: process.env.PI_WS_SANDBOX_ENV_POLICY ?? 'minimal',
    mode: process.env.PI_WS_SANDBOX_MODE ?? 'process',
  },
});

if (authToken !== undefined && authToken !== '') {
  pipe.addHook(
    'onAuth',
    createStaticTokenAuthHook({
      token: authToken,
      queryParam: authQueryParam,
      createSession: async (request) => ({
        clientAddress: request.remoteAddress ?? 'unknown',
      }),
    }),
  );
}

pipe.handle({
  method: 'get',
  path: '/api/hello',
  handler: (res) => {
    res
      .writeHeader('content-type', 'application/json')
      .end(JSON.stringify({ hello: 'pi-ws' }));
  },
});

if (authToken !== undefined && authToken !== '') {
  const authorize = new StaticTokenAuthorizer({
    token: authToken,
    queryParam: authQueryParam,
  }).authorize;

  pipe.handle({
    method: 'get',
    path: '/api/private',
    handler: protectHttpHandler({
      handler: (res) => {
        res
          .writeHeader('content-type', 'application/json')
          .end(JSON.stringify({ ok: true }));
      },
      authorize,
    }),
  });
}

pipe.route({
  path: '/ws/echo',
  behavior: {
    message(ws, message, isBinary) {
      ws.send(message, isBinary);
    },
  },
});

const server = await pipe.listen();

logger.info(
  {
    artifactDir,
    artifactLogFile,
    chatUrl: `http://127.0.0.1:${String(server.port)}/examples/chat/`,
    serverUrl: `http://127.0.0.1:${String(server.port)}`,
    sandboxDir,
    websocketUrl: `ws://127.0.0.1:${String(server.port)}/ws/pi`,
  },
  'pi-ws embedded example listening',
);
if (authToken !== undefined && authToken !== '') {
  logger.info(
    {
      browserAuth: 'send {"type":"pi_ws_auth","token":"..." } first',
      privateHttpRoute: `http://127.0.0.1:${String(server.port)}/api/private`,
    },
    'auth enabled with PI_WS_AUTH_TOKEN',
  );
}

const stop = () => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
