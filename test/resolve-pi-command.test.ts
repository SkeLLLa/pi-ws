import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePiCommand } from '../src/pi/resolve-pi-command.js';

void test('resolvePiCommand uses bundled pi cli when no override is set', () => {
  const resolved = resolvePiCommand({
    args: [],
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
      args: [],
      env: {},
    }),
    {
      command: '/custom/pi',
      args: ['--mode', 'rpc'],
    },
  );
});

void test('resolvePiCommand builds Pi CLI args from higher-level config', () => {
  assert.deepEqual(
    resolvePiCommand({
      command: '/custom/pi',
      env: {},
      provider: 'openai',
      model: 'gpt-5',
      thinking: 'high',
      sessionName: 'release review',
      systemPrompt: 'Be careful.',
      appendSystemPrompt: ['Prefer tests.'],
      extensions: ['./extensions/a.ts'],
      promptTemplates: ['./prompts/review.md'],
      args: ['--mode', 'json', '--no-session'],
    }),
    {
      command: '/custom/pi',
      args: [
        '--mode',
        'rpc',
        '--provider',
        'openai',
        '--model',
        'gpt-5',
        '--thinking',
        'high',
        '--name',
        'release review',
        '--system-prompt',
        'Be careful.',
        '--append-system-prompt',
        'Prefer tests.',
        '--extension',
        './extensions/a.ts',
        '--prompt-template',
        './prompts/review.md',
        '--no-session',
      ],
    },
  );
});
