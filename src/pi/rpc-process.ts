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

export class PiRpcProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  #closed = false;

  constructor({
    config,
    handlers,
  }: {
    config: PiProcessConfig;
    handlers: PiRpcProcessHandlers;
  }) {
    const resolved = resolvePiCommand(config);
    this.#child = spawn(resolved.command, [...resolved.args], {
      cwd: config.cwd,
      env: resolvePiEnvironment(config),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout = new JsonlSplitter();

    this.#child.stdout.on('data', (chunk: Buffer) => {
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

    this.#child.stderr.on('data', (chunk: Buffer) => {
      handlers.onStderr(chunk.toString('utf8'));
    });

    this.#child.once('error', handlers.onError);
    this.#child.once('exit', handlers.onExit);
  }

  send(message: Record<string, unknown>): void {
    if (this.#closed || this.#child.stdin.destroyed) return;
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.stdin.end();
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGTERM');
    }
  }
}

function resolvePiEnvironment(
  config: PiProcessConfig,
): Readonly<Record<string, string>> {
  if (config.agentDir === undefined || config.agentDir.trim() === '') {
    return config.env;
  }
  return { ...config.env, PI_CODING_AGENT_DIR: config.agentDir };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
