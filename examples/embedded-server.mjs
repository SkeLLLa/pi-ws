import {
  createStaticTokenAuthHook,
  PiWs,
  protectHttpHandler,
  StaticTokenAuthorizer,
} from '../dist/index.js';

const authToken = process.env.PI_WS_AUTH_TOKEN;
const authQueryParam = process.env.PI_WS_AUTH_QUERY_PARAM ?? 'token';

const pipe = new PiWs({
  host: '127.0.0.1',
  port: 8787,
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

console.log(`example listening on http://127.0.0.1:${String(server.port)}`);
console.log(`pi rpc websocket: ws://127.0.0.1:${String(server.port)}/ws/pi`);
console.log(
  `chat example: http://127.0.0.1:${String(server.port)}/examples/chat/`,
);
if (authToken !== undefined && authToken !== '') {
  console.log(`auth: enabled with PI_WS_AUTH_TOKEN`);
  console.log(
    `browser auth: send {"type":"pi_ws_auth","token":"..." } as the first message`,
  );
  console.log(
    `private http route: http://127.0.0.1:${String(server.port)}/api/private`,
  );
}

const stop = () => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
