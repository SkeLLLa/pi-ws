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
  assert.equal(config.artifacts.enabled, true);
  assert.equal(config.artifacts.maxFileBytes, 25 * 1024 * 1024);
  assert.equal(config.artifacts.chunkSizeBytes, 256 * 1024);
  assert.equal(config.artifacts.logLevel, 'silent');
  assert.equal(config.sandbox.mode, 'off');
  assert.equal(config.sandbox.envPolicy, 'minimal');
});

void test('loadConfig parses env overrides', async () => {
  const config = await loadConfig({
    cwd: '/workspace',
    env: {
      PI_WS_HOST: '127.0.0.1',
      PI_WS_PORT: '9000',
      PI_WS_PREFIX: 'rpc/',
      PI_WS_ARTIFACTS_ENABLED: 'true',
      PI_WS_ARTIFACTS_DIR: './artifacts',
      PI_WS_ARTIFACTS_MAX_FILE_BYTES: '2048',
      PI_WS_ARTIFACTS_CHUNK_SIZE_BYTES: '512',
      PI_WS_ARTIFACTS_SCAN_INTERVAL_MS: '900',
      PI_WS_ARTIFACTS_STABILITY_WINDOW_MS: '1200',
      PI_WS_ARTIFACTS_LOG_LEVEL: 'debug',
      PI_WS_ARTIFACTS_LOG_FILE: './logs/pi-ws.log',
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
      PI_WS_SANDBOX_MODE: 'system',
      PI_WS_SANDBOX_CWD: './sandbox',
      PI_WS_SANDBOX_ALLOW_READ_DIRS: '["./inputs","/shared"]',
      PI_WS_SANDBOX_ALLOW_WRITE_DIRS: '["./scratch"]',
      PI_WS_SANDBOX_ENV_POLICY: 'allowlist',
      PI_WS_SANDBOX_ENV_ALLOWLIST: '["OPENAI_API_KEY"]',
      PI_WS_SANDBOX_ENV: '{"EXTRA":"1"}',
      PI_WS_SANDBOX_DENY_SERVER_DIRECTORY: 'false',
      PI_WS_SANDBOX_COMMAND: 'bwrap',
      PI_WS_SANDBOX_ARGS: '["--ro-bind","{allowReadDirs}"]',
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
  assert.equal(config.artifacts.enabled, true);
  assert.equal(config.artifacts.dir, '/workspace/artifacts');
  assert.equal(config.artifacts.maxFileBytes, 2048);
  assert.equal(config.artifacts.chunkSizeBytes, 512);
  assert.equal(config.artifacts.scanIntervalMs, 900);
  assert.equal(config.artifacts.stabilityWindowMs, 1200);
  assert.equal(config.artifacts.logLevel, 'debug');
  assert.equal(config.artifacts.logFile, '/workspace/logs/pi-ws.log');
  assert.equal(config.sandbox.mode, 'system');
  assert.equal(config.sandbox.cwd, '/workspace/sandbox');
  assert.deepEqual(config.sandbox.allowReadDirs, [
    '/workspace/inputs',
    '/shared',
  ]);
  assert.deepEqual(config.sandbox.allowWriteDirs, ['/workspace/scratch']);
  assert.equal(config.sandbox.envPolicy, 'allowlist');
  assert.deepEqual(config.sandbox.envAllowlist, ['OPENAI_API_KEY']);
  assert.deepEqual(config.sandbox.env, { EXTRA: '1' });
  assert.equal(config.sandbox.denyServerDirectory, false);
  assert.equal(config.sandbox.command, 'bwrap');
  assert.deepEqual(config.sandbox.args, ['--ro-bind', '{allowReadDirs}']);
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
