import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { Logger } from 'pino';
import type { PiWsArtifactConfig } from '../server/types.js';
import { detectMimeType } from './mime.js';

export interface ArtifactTransfer {
  readonly absolutePath: string;
  readonly id: string;
  readonly mimeType: string;
  readonly name: string;
  readonly relativePath: string;
  readonly size: number;
}

interface ArtifactEntryState {
  absolutePath: string;
  firstSeenAtMs: number;
  lastMtimeMs: number;
  lastSize: number;
  sending: boolean;
  sent: boolean;
  skippedReason?: string;
}

export interface ArtifactManagerCallbacks {
  readonly onArtifact: (artifact: ArtifactTransfer) => Promise<void> | void;
  readonly onSkip: (details: {
    absolutePath: string;
    name: string;
    reason: string;
    relativePath: string;
    size: number;
  }) => void;
}

export class ArtifactManager {
  readonly #callbacks: ArtifactManagerCallbacks;
  readonly #config: PiWsArtifactConfig;
  readonly #entries = new Map<string, ArtifactEntryState>();
  readonly #logger: Logger;
  readonly #rootDir: string;

  #polling = false;
  #queue: Promise<void> = Promise.resolve();
  #timer: NodeJS.Timeout | undefined;

  constructor({
    callbacks,
    config,
    logger,
    rootDir,
  }: {
    callbacks: ArtifactManagerCallbacks;
    config: PiWsArtifactConfig;
    logger: Logger;
    rootDir: string;
  }) {
    this.#callbacks = callbacks;
    this.#config = config;
    this.#logger = logger.child({ component: 'artifact-manager' });
    this.#rootDir = rootDir;
  }

  get rootDir(): string {
    return this.#rootDir;
  }

  start(): void {
    if (!this.#config.enabled) return;

    mkdirSync(this.#rootDir, { recursive: true });
    this.#logger.debug({ rootDir: this.#rootDir }, 'artifact manager started');
    void this.poll();
    this.#timer = setInterval(() => {
      void this.poll();
    }, this.#config.scanIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }

    await this.#queue;
  }

  async poll(): Promise<void> {
    if (!this.#config.enabled || this.#polling) return;
    this.#polling = true;

    try {
      const now = Date.now();
      const rootDir = await realpath(this.#rootDir);
      const files = await walkFiles(rootDir);

      for (const absolutePath of files) {
        const realAbsolutePath = await realpath(absolutePath);
        if (!isPathInsideDirectory(realAbsolutePath, rootDir)) continue;

        const info = await stat(realAbsolutePath);
        if (!info.isFile()) continue;
        this.#trackFile({
          absolutePath: realAbsolutePath,
          mtimeMs: info.mtimeMs,
          now,
          rootDir,
          size: info.size,
        });
      }
    } finally {
      this.#polling = false;
    }
  }

  #trackFile({
    absolutePath,
    mtimeMs,
    now,
    rootDir,
    size,
  }: {
    absolutePath: string;
    mtimeMs: number;
    now: number;
    rootDir: string;
    size: number;
  }): void {
    const relativePath =
      relative(rootDir, absolutePath) || basename(absolutePath);
    if (!isPathInsideDirectory(absolutePath, rootDir)) {
      return;
    }

    const name = basename(absolutePath);
    const existing = this.#entries.get(absolutePath);

    if (
      existing?.sent ||
      existing?.sending ||
      existing?.skippedReason !== undefined
    ) {
      return;
    }

    if (size > this.#config.maxFileBytes) {
      this.#entries.set(absolutePath, {
        absolutePath,
        firstSeenAtMs: existing?.firstSeenAtMs ?? now,
        lastMtimeMs: mtimeMs,
        lastSize: size,
        sending: false,
        sent: false,
        skippedReason: `File exceeds max size of ${String(this.#config.maxFileBytes)} bytes`,
      });
      this.#logger.warn(
        { absolutePath, reason: 'max_file_bytes', size },
        'artifact skipped',
      );
      this.#callbacks.onSkip({
        absolutePath,
        name,
        reason: 'max_file_bytes',
        relativePath,
        size,
      });
      return;
    }

    if (existing === undefined) {
      this.#entries.set(absolutePath, {
        absolutePath,
        firstSeenAtMs: now,
        lastMtimeMs: mtimeMs,
        lastSize: size,
        sending: false,
        sent: false,
      });
      this.#logger.trace({ absolutePath, size }, 'artifact observed');
      return;
    }

    if (existing.lastMtimeMs !== mtimeMs || existing.lastSize !== size) {
      this.#entries.set(absolutePath, {
        absolutePath,
        firstSeenAtMs: now,
        lastMtimeMs: mtimeMs,
        lastSize: size,
        sending: false,
        sent: false,
      });
      this.#logger.trace({ absolutePath, size }, 'artifact observed');
      return;
    }

    if (now - existing.firstSeenAtMs < this.#config.stabilityWindowMs) {
      return;
    }

    this.#entries.set(absolutePath, {
      ...existing,
      sending: true,
    });

    const artifact: ArtifactTransfer = {
      absolutePath,
      id: randomUUID(),
      mimeType: detectMimeType(absolutePath),
      name,
      relativePath,
      size,
    };

    this.#logger.debug(
      { absolutePath, artifactId: artifact.id, size },
      'artifact ready',
    );
    this.#queue = this.#queue
      .then(async () => {
        await this.#callbacks.onArtifact(artifact);
        this.#entries.set(absolutePath, {
          ...existing,
          sending: false,
          sent: true,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.#entries.set(absolutePath, {
          ...existing,
          firstSeenAtMs: Date.now(),
          sending: false,
          sent: false,
        });
        this.#logger.error(
          { absolutePath, artifactId: artifact.id, error: message },
          'artifact transfer failed',
        );
      });
  }
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }

      const info = await lstat(absolutePath);
      if (info.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (info.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path));
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}
