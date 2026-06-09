import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISABLED } from 'uWebSockets.js';
import { PiPipe } from '../src/index.js';

void test('PiPipe exposes chainable extension methods', () => {
  const pipe = new PiPipe({
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
  assert.doesNotThrow(() => pipe.createApp());
});
