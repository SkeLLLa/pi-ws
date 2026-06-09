import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { JsonlSplitter, parseJsonObject } from '../utils/jsonl.js';
import type { PreparedPiLaunch } from './sandbox.js';

export interface PiRpcProcessHandlers {
  readonly onMessage: (message: Record<string, unknown>) => void;
  readonly onStderr: (chunk: string) => void;
  readonly onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  readonly onError: (error: Error) => void;
}

export class PiRpcProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  #closed = false;
  #killTimer: NodeJS.Timeout | undefined;

  constructor({
    handlers,
    launch,
  }: {
    handlers: PiRpcProcessHandlers;
    launch: PreparedPiLaunch;
  }) {
    this.#child = spawn(launch.command, launch.resolvedCommandLine.slice(1), {
      cwd: launch.cwd,
      detached: process.platform !== 'win32',
      env: launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout = new JsonlSplitter();

    this.#child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const line of stdout.push(chunk)) {
          handleStdoutLine({ handlers, line });
        }
      } catch (error) {
        handlers.onError(
          new Error(`Invalid JSON from pi stdout: ${getErrorMessage(error)}`),
        );
      }
    });
    this.#child.stdout.once('close', () => {
      try {
        for (const line of stdout.flush()) {
          handleStdoutLine({ handlers, line });
        }
      } catch (error) {
        handlers.onError(
          new Error(`Invalid JSON from pi stdout: ${getErrorMessage(error)}`),
        );
      }
    });

    this.#child.stderr.on('data', (chunk: Buffer) => {
      handlers.onStderr(chunk.toString('utf8'));
    });

    this.#child.once('error', handlers.onError);
    this.#child.once('exit', (code, signal) => {
      if (this.#killTimer !== undefined) {
        clearTimeout(this.#killTimer);
        this.#killTimer = undefined;
      }
      handlers.onExit(code, signal);
    });
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
      this.#kill('SIGTERM');
      this.#killTimer = setTimeout(() => {
        if (this.#child.exitCode === null && this.#child.signalCode === null) {
          this.#kill('SIGKILL');
        }
      }, 5_000);
      this.#killTimer.unref();
    }
  }

  #kill(signal: NodeJS.Signals): void {
    if (process.platform === 'win32' || this.#child.pid === undefined) {
      this.#child.kill(signal);
      return;
    }

    try {
      process.kill(-this.#child.pid, signal);
    } catch {
      this.#child.kill(signal);
    }
  }
}

function handleStdoutLine({
  handlers,
  line,
}: {
  handlers: PiRpcProcessHandlers;
  line: string;
}): void {
  if (line === '') return;

  try {
    handlers.onMessage(parseJsonObject(line));
  } catch (error) {
    handlers.onError(
      new Error(`Invalid JSON from pi stdout: ${getErrorMessage(error)}`),
    );
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
