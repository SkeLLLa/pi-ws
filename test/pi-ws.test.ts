import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISABLED } from 'uWebSockets.js';
import {
  createStaticTokenAuthHook,
  PiWs,
  protectHttpHandler,
  StaticTokenAuthorizer,
} from '../src/index.js';

void test('PiWs exposes chainable extension methods', () => {
  const pipe = new PiWs({
    chatExample: false,
  });

  assert.equal(
    pipe.handle({
      method: 'get',
      path: '/custom',
      handler: (res) => {
        res.end('ok');
      },
    }),
    pipe,
  );
  assert.equal(
    pipe.route({
      path: '/ws/custom',
      behavior: {
        compression: DISABLED,
        message(ws, message, isBinary) {
          ws.send(message, isBinary);
        },
      },
    }),
    pipe,
  );
  assert.equal(
    pipe.use((app) => {
      app.get('/installed', (res) => {
        res.end('ok');
      });
    }),
    pipe,
  );
  assert.equal(
    pipe.addHook('onRequest', async (_request, context) => {
      context.locals['source'] = 'test';
    }),
    pipe,
  );
  assert.equal(
    pipe.configure({
      host: '127.0.0.1',
    }),
    pipe,
  );
  assert.equal(
    pipe.configurePi({
      model: 'gpt-5',
    }),
    pipe,
  );
  assert.equal(pipe.setChatExample(false), pipe);
  assert.doesNotThrow(() => pipe.createApp());
});

void test('PiWs exposes composable configuration helpers', () => {
  const pipe = new PiWs({ chatExample: true })
    .configure({
      host: '127.0.0.1',
      port: 9999,
    })
    .configurePi({
      provider: 'openai',
      model: 'gpt-5',
      systemPrompt: 'Be strict.',
    })
    .setChatExample(false);

  const config = pipe.getConfig();

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 9999);
  assert.equal(config.chatExample, false);
  assert.equal(config.pi.provider, 'openai');
  assert.equal(config.pi.model, 'gpt-5');
  assert.equal(config.pi.systemPrompt, 'Be strict.');
});

void test('PiWs stores typed built-in route hooks in config', () => {
  const pipe = new PiWs<{ userId: string }>({ chatExample: false }).addHook(
    'onAuth',
    createStaticTokenAuthHook({
      token: 'secret',
      createSession: async () => ({ userId: 'user-1' }),
    }),
  );

  const config = pipe.getConfig();
  assert.equal(config.piHooks?.onAuth?.length, 1);
});

void test('StaticTokenAuthorizer class authorizes correctly', () => {
  const auth = new StaticTokenAuthorizer({ token: 'abc' });

  assert.deepEqual(
    auth.authorize({
      method: 'GET',
      path: '/ws/pi',
      query: '',
      url: '/ws/pi',
      queryParams: {},
      headers: { authorization: 'Bearer abc' },
    }),
    { authorized: true },
  );

  assert.equal(
    auth.authorize({
      method: 'GET',
      path: '/ws/pi',
      query: '',
      url: '/ws/pi',
      queryParams: {},
      headers: { authorization: 'Bearer wrong' },
    }).authorized,
    false,
  );
});

void test('protectHttpHandler uses object args', () => {
  const protected_ = protectHttpHandler({
    handler: (res) => {
      void res;
    },
    authorize: () => ({ authorized: true }),
  });
  assert.equal(typeof protected_, 'function');
});
