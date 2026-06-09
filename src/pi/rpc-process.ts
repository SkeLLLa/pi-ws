import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { PiProcessConfig } from '../server/types.js';
import { JsonlSplitter, parseJsonObject } from '../utils/jsonl.js';
import { resolvePiCommand } from './resolve-pi-command.js';

export interface PiRpcProcessHandlers {
  readonly onMessage: (message: Record<string, unknown>) => void;
  readonly onStderr: (chunk: string) => void;
  readonly onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  readonly onError: (error: Error) => void;
}

export interface PiRpcProcess {
  send(message: Record<string, unknown>): void;
  close(): void;
}

export function startPiRpcProcess(
  config: PiProcessConfig,
  handlers: PiRpcProcessHandlers,
): PiRpcProcess {
  const resolved = resolvePiCommand(config);
  const child = spawn(resolved.command, resolved.args, {
    cwd: config.cwd,
    env: config.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdout = new JsonlSplitter();

  child.stdout.on('data', (chunk: Buffer) => {
    for (const line of stdout.push(chunk)) {
      if (line === '') continue;

      try {
        handlers.onMessage(parseJsonObject(line));
      } catch (error) {
        handlers.onError(
          new Error(`Invalid JSON from pi stdout: ${getErrorMessage(error)}`),
        );
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    handlers.onStderr(chunk.toString('utf8'));
  });

  child.once('error', handlers.onError);
  child.once('exit', handlers.onExit);

  return createPiRpcProcess(child);
}

function createPiRpcProcess(
  child: ChildProcessWithoutNullStreams,
): PiRpcProcess {
  let closed = false;

  return {
    send(message) {
      if (closed || child.stdin.destroyed) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      child.stdin.end();

      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
