import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/server/config.js';

void test('loadConfig applies defaults', () => {
  const config = loadConfig({});

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8787);
  assert.equal(config.wsPrefix, '/ws');
  assert.deepEqual(config.pi.args, ['--mode', 'rpc']);
});

void test('loadConfig parses env overrides', () => {
  const config = loadConfig({
    PI_PIPE_HOST: '127.0.0.1',
    PI_PIPE_PORT: '9000',
    PI_PIPE_WS_PREFIX: 'rpc/',
    PI_PIPE_PI_COMMAND: '/custom/pi',
    PI_PIPE_PI_ARGS: '["--provider","openai","--model","gpt-5"]',
    PI_PIPE_PI_CWD: '/repo',
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 9000);
  assert.equal(config.wsPrefix, '/rpc');
  assert.equal(config.pi.command, '/custom/pi');
  assert.equal(config.pi.cwd, '/repo');
  assert.deepEqual(config.pi.args, [
    '--mode',
    'rpc',
    '--provider',
    'openai',
    '--model',
    'gpt-5',
  ]);
});
