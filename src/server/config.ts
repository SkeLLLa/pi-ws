import type { PiProcessConfig, PiWsConfig } from './types.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const DEFAULT_WS_PREFIX = '/ws';
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

/**
 * Loads `PiWs` configuration from environment variables.
 *
 * @remarks
 * Supported variables include `PI_WS_HOST`, `PI_WS_PORT`,
 * `PI_WS_PREFIX`, `PI_WS_MAX_PAYLOAD_BYTES`,
 * `PI_WS_CHAT_EXAMPLE`, `PI_WS_PI_COMMAND`, `PI_WS_PI_ARGS`, and
 * `PI_WS_PI_CWD`. Values are validated and normalized before being returned.
 *
 * @param env - Source environment, usually `process.env`.
 * @returns Parsed server configuration with defaults applied.
 * @public
 */
export function loadConfig(env: NodeJS.ProcessEnv): PiWsConfig {
  return {
    host: env['PI_WS_HOST'] ?? DEFAULT_HOST,
    port: parsePort(env['PI_WS_PORT']),
    wsPrefix: normalizePrefix(env['PI_WS_PREFIX'] ?? DEFAULT_WS_PREFIX),
    maxPayloadBytes: parsePositiveInteger(
      env['PI_WS_MAX_PAYLOAD_BYTES'],
      DEFAULT_MAX_PAYLOAD_BYTES,
      'PI_WS_MAX_PAYLOAD_BYTES',
    ),
    chatExample: parseBoolean(env['PI_WS_CHAT_EXAMPLE'], true),
    pi: loadPiConfig(env),
  };
}

function loadPiConfig(env: NodeJS.ProcessEnv): PiProcessConfig {
  const command = env['PI_WS_PI_COMMAND'];
  const cwd = env['PI_WS_PI_CWD'];

  return {
    env: pickPiEnvironment(env),
    args: ['--mode', 'rpc', ...parseArgs(env['PI_WS_PI_ARGS'])],
    ...(command === undefined || command === '' ? {} : { command }),
    ...(cwd === undefined || cwd === '' ? {} : { cwd }),
  };
}

function parsePort(value: string | undefined): number {
  return parsePositiveInteger(value, DEFAULT_PORT, 'PI_WS_PORT');
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function normalizePrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '/') return '';

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
      return true;
    case '0':
    case 'false':
    case 'no':
      return false;
    default:
      throw new Error('PI_WS_CHAT_EXAMPLE must be a boolean');
  }
}

function parseArgs(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== 'string')
    ) {
      throw new Error('PI_WS_PI_ARGS JSON value must be a string array');
    }

    return parsed as string[];
  }

  return trimmed.split(/\s+/u);
}

function pickPiEnvironment(
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
