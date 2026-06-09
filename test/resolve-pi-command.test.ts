import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePiCommand } from '../src/pi/resolve-pi-command.js';

void test('resolvePiCommand uses bundled pi cli when no override is set', () => {
  const resolved = resolvePiCommand({
    args: ['--mode', 'rpc'],
    env: {},
  });

  assert.equal(resolved.command, process.execPath);
  assert.match(resolved.args[0] ?? '', /pi-coding-agent.*dist\/cli\.js/u);
  assert.deepEqual(resolved.args.slice(1), ['--mode', 'rpc']);
});

void test('resolvePiCommand respects explicit command override', () => {
  assert.deepEqual(
    resolvePiCommand({
      command: '/custom/pi',
      args: ['--mode', 'rpc'],
      env: {},
    }),
    {
      command: '/custom/pi',
      args: ['--mode', 'rpc'],
    },
  );
});
