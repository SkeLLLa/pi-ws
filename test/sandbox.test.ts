import assert from 'node:assert/strict';
import { test } from 'node:test';
import pinoFactory from 'pino';
import { preparePiLaunch } from '../src/pi/sandbox.js';

const logger = pinoFactory({ enabled: false });

void test('preparePiLaunch injects artifact path and prompt hints in off mode', () => {
  const launch = preparePiLaunch({
    artifactDir: '/tmp/artifacts/conn-1',
    connectionId: 'conn-1',
    logger,
    pi: {
      args: ['--no-session'],
      env: {
        OPENAI_API_KEY: 'secret',
        SECRET_SERVER_TOKEN: 'do-not-pass',
      },
    },
    sandbox: {
      mode: 'off',
      cwd: '/tmp/sandbox',
      allowReadDirs: [],
      allowWriteDirs: [],
      envPolicy: 'minimal',
      envAllowlist: [],
      env: { EXTRA_ENV: '1' },
      denyServerDirectory: true,
      args: [],
    },
    serverRoot: '/workspace/pi-ws',
  });

  assert.equal(launch.command, process.execPath);
  assert.equal(launch.cwd, undefined);
  assert.equal(launch.env['PI_WS_ARTIFACT_DIR'], '/tmp/artifacts/conn-1');
  assert.equal(launch.env['OPENAI_API_KEY'], 'secret');
  assert.equal(launch.env['SECRET_SERVER_TOKEN'], undefined);
  assert.equal(launch.env['EXTRA_ENV'], '1');
  assert.match(
    launch.promptHints[0] ?? '',
    /Artifact output is enabled at \/tmp\/artifacts\/conn-1/u,
  );
  assert.match(launch.promptHints[0] ?? '', /draw, plot, chart/u);
  assert.match(
    launch.promptHints[0] ?? '',
    /exact absolute artifact directory/u,
  );
  assert.match(launch.promptHints[0] ?? '', /PI_WS_ARTIFACT_DIR/u);
  assert.match(launch.promptHints[0] ?? '', /\.\.\/artifacts/u);
  assert.match(
    launch.promptHints[0] ?? '',
    /Do not print absolute artifact paths/u,
  );
  assert.match(launch.promptHints[0] ?? '', /tool or language package/u);
  assert.match(launch.promptHints[0] ?? '', /dependency-free fallback/u);
  assert.match(launch.promptHints[0] ?? '', /generic follow-up offers/u);
  assert.match(launch.promptHints[0] ?? '', /pi\.show, plt\.show/u);
  assert.deepEqual(launch.resolvedCommandLine.slice(-1), ['--no-session']);
  assert.match(launch.resolvedCommandLine.join(' '), /--append-system-prompt/u);
});

void test('preparePiLaunch builds minimal sandbox environment', () => {
  const launch = preparePiLaunch({
    artifactDir: '/tmp/artifacts/conn-2',
    connectionId: 'conn-2',
    logger,
    pi: {
      args: [],
      env: {
        OPENAI_API_KEY: 'secret',
        SECRET_SERVER_TOKEN: 'do-not-pass',
      },
    },
    sandbox: {
      mode: 'process',
      cwd: '/tmp/pi-ws-sandbox',
      allowReadDirs: ['/data/in'],
      allowWriteDirs: ['/data/out'],
      envPolicy: 'minimal',
      envAllowlist: [],
      env: { CUSTOM_FLAG: 'yes' },
      denyServerDirectory: true,
      args: [],
    },
    serverRoot: '/workspace/pi-ws',
  });

  assert.equal(launch.cwd, '/tmp/pi-ws-sandbox/conn-2/cwd');
  assert.equal(launch.env['HOME'], '/tmp/pi-ws-sandbox/conn-2/home');
  assert.equal(launch.env['TMPDIR'], '/tmp/pi-ws-sandbox/conn-2/tmp');
  assert.equal(launch.env['PYTHONUSERBASE'], undefined);
  assert.equal(launch.env['PIP_CACHE_DIR'], undefined);
  assert.equal(launch.env['MPLCONFIGDIR'], undefined);
  assert.equal(launch.env['OPENAI_API_KEY'], 'secret');
  assert.equal(launch.env['SECRET_SERVER_TOKEN'], undefined);
  assert.equal(launch.env['CUSTOM_FLAG'], 'yes');
  assert.equal(
    launch.env['PI_WS_SANDBOX_ALLOW_WRITE_DIRS'],
    JSON.stringify([
      '/data/out',
      '/tmp/pi-ws-sandbox/conn-2',
      '/tmp/artifacts/conn-2',
    ]),
  );
  assert.match(launch.promptHints.join('\n'), /HOME, TMPDIR/u);
  assert.match(launch.promptHints.join('\n'), /Package installs/u);
  assert.match(launch.promptHints.join('\n'), /virtual environments/u);
  assert.match(launch.promptHints.join('\n'), /no-dependency fallback/u);
  assert.doesNotMatch(launch.promptHints.join('\n'), /matplotlib/u);
  assert.doesNotMatch(launch.promptHints.join('\n'), /MPLCONFIGDIR/u);
});

void test('preparePiLaunch prevents sandbox env from overriding isolation vars', () => {
  const launch = preparePiLaunch({
    artifactDir: '/tmp/artifacts/conn-protected-env',
    connectionId: 'conn-protected-env',
    logger,
    pi: {
      args: [],
      env: {},
    },
    sandbox: {
      mode: 'process',
      cwd: '/tmp/pi-ws-sandbox',
      allowReadDirs: [],
      allowWriteDirs: [],
      envPolicy: 'minimal',
      envAllowlist: [],
      env: {
        HOME: '/unsafe/home',
        PI_WS_SANDBOX_CWD: '/unsafe/cwd',
        TMPDIR: '/unsafe/tmp',
      },
      denyServerDirectory: true,
      args: [],
    },
    serverRoot: '/workspace/pi-ws',
  });

  assert.equal(
    launch.env['HOME'],
    '/tmp/pi-ws-sandbox/conn-protected-env/home',
  );
  assert.equal(
    launch.env['PI_WS_SANDBOX_CWD'],
    '/tmp/pi-ws-sandbox/conn-protected-env/cwd',
  );
  assert.equal(
    launch.env['TMPDIR'],
    '/tmp/pi-ws-sandbox/conn-protected-env/tmp',
  );
});

void test('preparePiLaunch keeps package-specific env generic', () => {
  const launch = preparePiLaunch({
    artifactDir: undefined,
    connectionId: 'conn-tool-env',
    logger,
    pi: {
      args: [],
      env: {},
    },
    sandbox: {
      mode: 'process',
      cwd: '/tmp/pi-ws-sandbox',
      allowReadDirs: [],
      allowWriteDirs: [],
      envPolicy: 'minimal',
      envAllowlist: [],
      env: {
        TOOL_CACHE_DIR: '/tmp/custom-tool-cache',
      },
      denyServerDirectory: true,
      args: [],
    },
    serverRoot: '/workspace/pi-ws',
  });

  assert.equal(launch.env['TOOL_CACHE_DIR'], '/tmp/custom-tool-cache');
  assert.equal(launch.env['PYTHONUSERBASE'], undefined);
  assert.equal(launch.env['PIP_CACHE_DIR'], undefined);
  assert.equal(launch.env['MPLCONFIGDIR'], undefined);
});

void test('preparePiLaunch rejects sandbox cwd inside the server workspace', () => {
  assert.throws(
    () =>
      preparePiLaunch({
        artifactDir: undefined,
        connectionId: 'conn-3',
        logger,
        pi: {
          args: [],
          cwd: '/workspace/pi-ws',
          env: {},
        },
        sandbox: {
          mode: 'process',
          cwd: '/tmp/pi-ws-sandbox',
          allowReadDirs: [],
          allowWriteDirs: [],
          envPolicy: 'minimal',
          envAllowlist: [],
          env: {},
          denyServerDirectory: true,
          args: [],
        },
        serverRoot: '/workspace/pi-ws',
      }),
    /sandboxed Pi cwd must not point into the server workspace/u,
  );
});

void test('preparePiLaunch allows sandbox roots that live under the workspace', () => {
  const workspaceRoot = process.cwd();
  const launch = preparePiLaunch({
    artifactDir: `${workspaceRoot}/.tmp/pi-ws-example/artifacts/conn-4`,
    connectionId: 'conn-4',
    logger,
    pi: {
      args: [],
      env: {},
    },
    sandbox: {
      mode: 'process',
      cwd: `${workspaceRoot}/.tmp/pi-ws-example/sandbox`,
      allowReadDirs: [],
      allowWriteDirs: [],
      envPolicy: 'minimal',
      envAllowlist: [],
      env: {},
      denyServerDirectory: true,
      args: [],
    },
    serverRoot: workspaceRoot,
  });

  assert.equal(
    launch.cwd,
    `${workspaceRoot}/.tmp/pi-ws-example/sandbox/conn-4/cwd`,
  );
});
