import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISABLED } from 'uWebSockets.js';
import { PiWs } from '../src/index.js';

void test('PiWs exposes chainable extension methods', () => {
  const pipe = new PiWs({
    chatExample: false,
  });

  assert.equal(
    pipe.handle('get', '/custom', (res) => {
      res.end('ok');
    }),
    pipe,
  );
  assert.equal(
    pipe.route('/ws/custom', {
      compression: DISABLED,
      message(ws, message, isBinary) {
        ws.send(message, isBinary);
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
    pipe.authorize(() => ({ authorized: true })),
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
