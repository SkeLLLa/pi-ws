import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PiProcessConfig } from '../server/types.js';

export interface ResolvedPiCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function resolvePiCommand(config: PiProcessConfig): ResolvedPiCommand {
  if (config.command !== undefined && config.command.trim() !== '') {
    return {
      command: config.command,
      args: config.args,
    };
  }

  const bundledCli = resolveBundledPiCli();
  if (bundledCli !== undefined) {
    return {
      command: process.execPath,
      args: [bundledCli, ...config.args],
    };
  }

  return {
    command: 'pi',
    args: config.args,
  };
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
