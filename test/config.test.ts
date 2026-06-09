import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/server/config.js';

void test('loadConfig applies defaults', async () => {
  const config = await loadConfig({
    env: {},
    dotenv: false,
    rcFile: false,
    packageJson: false,
  });

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8787);
  assert.equal(config.wsPrefix, '/ws');
  assert.deepEqual(config.pi.args, []);
});

void test('loadConfig parses env overrides', async () => {
  const config = await loadConfig({
    env: {
      PI_WS_HOST: '127.0.0.1',
      PI_WS_PORT: '9000',
      PI_WS_PREFIX: 'rpc/',
      PI_WS_PI_COMMAND: '/custom/pi',
      PI_WS_PI_ARGS: '["--no-session"]',
      PI_WS_PI_CWD: '/repo',
      PI_WS_PI_AGENT_DIR: '/repo/.pi/agent',
      PI_WS_PI_PROVIDER: 'openai',
      PI_WS_PI_MODEL: 'gpt-5',
      PI_WS_PI_THINKING: 'high',
      PI_WS_PI_NAME: 'review',
      PI_WS_PI_SYSTEM_PROMPT: 'You are strict.',
      PI_WS_PI_APPEND_SYSTEM_PROMPT: '["Be concise.","Prefer tests."]',
      PI_WS_PI_EXTENSIONS: '["./extensions/auth.ts"]',
      PI_WS_PI_PROMPT_TEMPLATES: '["./prompts/review.md"]',
      PI_WS_AUTH_TOKEN: 'secret',
      PI_WS_AUTH_QUERY_PARAM: 'token',
      PI_WS_TLS_KEY_FILE: '/tls/key.pem',
      PI_WS_TLS_CERT_FILE: '/tls/cert.pem',
    },
    dotenv: false,
    rcFile: false,
    packageJson: false,
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 9000);
  assert.equal(config.wsPrefix, '/rpc');
  assert.equal(config.pi.command, '/custom/pi');
  assert.equal(config.pi.cwd, '/repo');
  assert.equal(config.pi.agentDir, '/repo/.pi/agent');
  assert.equal(config.pi.provider, 'openai');
  assert.equal(config.pi.model, 'gpt-5');
  assert.equal(config.pi.thinking, 'high');
  assert.equal(config.pi.sessionName, 'review');
  assert.equal(config.pi.systemPrompt, 'You are strict.');
  assert.deepEqual(config.pi.appendSystemPrompt, [
    'Be concise.',
    'Prefer tests.',
  ]);
  assert.deepEqual(config.pi.extensions, ['./extensions/auth.ts']);
  assert.deepEqual(config.pi.promptTemplates, ['./prompts/review.md']);
  assert.deepEqual(config.pi.args, ['--no-session']);
  assert.ok(config.tls);
  assert.equal(config.tls.keyFileName, '/tls/key.pem');
  assert.equal(config.tls.certFileName, '/tls/cert.pem');
  const onAuthHooks = config.piHooks?.onAuth;
  assert.ok(onAuthHooks);
  assert.equal(onAuthHooks.length, 1);
  const [onAuthHook] = onAuthHooks;
  assert.ok(onAuthHook);
  const decision = await onAuthHook(
    {
      source: 'request',
      provided: true,
      token: 'secret',
      request: {
        method: 'GET',
        path: '/ws/pi',
        query: 'token=secret',
        url: '/ws/pi?token=secret',
        queryParams: { token: 'secret' },
        headers: {},
      },
    },
    { locals: {} },
  );
  assert.notEqual(decision?.authorized, false);
});
