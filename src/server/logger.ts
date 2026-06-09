import pinoFactory, { destination, stdTimeFunctions, type Logger } from 'pino';
import type { PiWsArtifactConfig } from './types.js';

export function createPiWsLogger(config: PiWsArtifactConfig): Logger {
  return pinoFactory(
    {
      base: { service: 'pi-ws' },
      level: config.logLevel,
      name: 'pi-ws',
      timestamp: stdTimeFunctions.isoTime,
    },
    config.logFile === undefined
      ? destination(2)
      : destination({
          dest: config.logFile,
          mkdir: true,
          sync: false,
        }),
  );
}

export function createPiWsLoggerCacheKey(config: PiWsArtifactConfig): string {
  return `${config.logLevel}\0${config.logFile ?? ''}`;
}
