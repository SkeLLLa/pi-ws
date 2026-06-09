import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PiProcessConfig } from '../server/types.js';

export interface ResolvedPiCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function resolvePiCommand(config: PiProcessConfig): ResolvedPiCommand {
  const args = buildPiArgs(config);

  if (config.command !== undefined && config.command.trim() !== '') {
    return {
      command: config.command,
      args,
    };
  }

  const bundledCli = resolveBundledPiCli();
  if (bundledCli !== undefined) {
    return {
      command: process.execPath,
      args: [bundledCli, ...args],
    };
  }

  return {
    command: 'pi',
    args,
  };
}

function buildPiArgs(config: PiProcessConfig): string[] {
  const args = ['--mode', 'rpc'];

  pushFlag({ target: args, flag: '--provider', value: config.provider });
  pushFlag({ target: args, flag: '--model', value: config.model });
  pushFlag({ target: args, flag: '--thinking', value: config.thinking });
  pushFlag({ target: args, flag: '--name', value: config.sessionName });
  pushFlag({
    target: args,
    flag: '--system-prompt',
    value: config.systemPrompt,
  });

  for (const prompt of config.appendSystemPrompt ?? []) {
    pushFlag({ target: args, flag: '--append-system-prompt', value: prompt });
  }

  for (const extension of config.extensions ?? []) {
    pushFlag({ target: args, flag: '--extension', value: extension });
  }

  for (const template of config.promptTemplates ?? []) {
    pushFlag({ target: args, flag: '--prompt-template', value: template });
  }

  args.push(...stripModeArgs(config.args));
  return args;
}

function stripModeArgs(args: readonly string[]): string[] {
  const normalized: string[] = [];

  for (const [index, arg] of args.entries()) {
    if (arg === '--mode') {
      continue;
    }

    if (index > 0 && args[index - 1] === '--mode') {
      continue;
    }

    if (arg.startsWith('--mode=')) {
      continue;
    }

    normalized.push(arg);
  }

  return normalized;
}

function pushFlag({
  target,
  flag,
  value,
}: {
  target: string[];
  flag: string;
  value: string | undefined;
}): void {
  if (value === undefined || value.trim() === '') return;
  target.push(flag, value);
}

function resolveBundledPiCli(): string | undefined {
  try {
    const entrypoint = fileURLToPath(
      import.meta.resolve('@earendil-works/pi-coding-agent'),
    );
    const cli = join(dirname(entrypoint), 'cli.js');
    return existsSync(cli) ? cli : undefined;
  } catch {
    return undefined;
  }
}
