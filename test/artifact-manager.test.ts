import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import pinoFactory from 'pino';
import {
  ArtifactManager,
  type ArtifactTransfer,
} from '../src/artifacts/artifact-manager.js';

const logger = pinoFactory({ enabled: false });

void test('ArtifactManager skips symlinks that point outside the artifact root', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'pi-ws-artifacts-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'pi-ws-outside-'));
  const outsideFile = join(outsideDir, 'secret.txt');
  const symlinkPath = join(rootDir, 'leak.txt');
  const artifacts: ArtifactTransfer[] = [];

  await writeFile(outsideFile, 'secret');
  await symlink(outsideFile, symlinkPath);

  const manager = new ArtifactManager({
    callbacks: {
      onArtifact: (artifact) => {
        artifacts.push(artifact);
      },
      onSkip: () => {
        void artifacts.length;
      },
    },
    config: {
      enabled: true,
      dir: rootDir,
      maxFileBytes: 1024,
      chunkSizeBytes: 1024,
      scanIntervalMs: 1000,
      stabilityWindowMs: 0,
      logLevel: 'silent',
    },
    logger,
    rootDir,
  });

  await manager.poll();
  await manager.poll();

  assert.deepEqual(artifacts, []);
});
