import {
  createDefineConfig as createC12DefineConfig,
  loadConfig as loadC12Config,
  type DotenvOptions,
} from 'c12';
import { createStaticTokenAuthorizer } from './auth.js';
import type {
  PiProcessConfig,
  PiProcessOptions,
  PiWsConfig,
  PiWsOptions,
  PiWsTlsConfig,
  RequestAuthorizer,
} from './types.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const DEFAULT_WS_PREFIX = '/ws';
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

/**
 * Options for `loadConfig()`.
 *
 * @remarks
 * `pi-ws` uses `c12` v4 to load configuration from config files, package.json,
 * dotenv files, defaults, and environment-derived overrides. Explicit
 * `overrides` passed here take precedence over `PI_WS_*` environment variables.
 *
 * @public
 */
export interface PiWsConfigLoaderOptions {
  /**
   * Working directory used for config resolution.
   *
   * @defaultValue `process.cwd()`
   */
  readonly cwd?: string;
  /**
   * Environment variables used for Pi env inheritance and `PI_WS_*` overrides.
   *
   * @defaultValue `process.env`
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Optional dotenv loading behavior.
   *
   * @defaultValue `{ fileName: ['.env', '.env.local'] }`
   */
  readonly dotenv?: boolean | DotenvOptions;
  /**
   * Optional environment name used for c12's `$development`, `$production`,
   * and `$env` sections.
   *
   * @defaultValue `process.env.NODE_ENV`
   */
  readonly envName?: string | false;
  /**
   * Optional main config file basename without extension.
   *
   * @defaultValue `"pi-ws.config"`
   */
  readonly configFile?: string;
  /**
   * Optional rc config basename.
   *
   * @defaultValue `false`
   */
  readonly rcFile?: false | string;
  /**
   * Whether to load a matching global rc file.
   *
   * @defaultValue `false`
   */
  readonly globalRc?: boolean;
  /**
   * Whether to load config from `package.json`, or which fields to read.
   *
   * @defaultValue `['pi-ws']`
   */
  readonly packageJson?: boolean | string | string[];
  /**
   * Highest-priority code overrides applied after config files and env-derived
   * overrides.
   */
  readonly overrides?: PiWsOptions;
}

/**
 * Typed helper for authoring `pi-ws` config files.
 *
 * @remarks
 * Example:
 *
 * ```ts
 * import { definePiWsConfig } from 'pi-ws';
 *
 * export default definePiWsConfig({
 *   host: '127.0.0.1',
 *   pi: {
 *     model: 'gpt-4.1',
 *   },
 * });
 * ```
 *
 * @public
 */
export const definePiWsConfig = createC12DefineConfig<PiWsOptions>();

/**
 * Loads `PiWs` configuration from c12 config sources plus `PI_WS_*`
 * environment overrides.
 *
 * @remarks
 * The resolved config order is:
 *
 * 1. Explicit `overrides` passed to this function
 * 2. `PI_WS_*` environment variables
 * 3. `pi-ws.config.*` files discovered by c12
 * 4. `package.json` `pi-ws` field when enabled
 * 5. Built-in defaults
 *
 * @param options - Loader settings and high-priority overrides.
 * @returns Fully-resolved runtime configuration.
 * @public
 */
export async function loadConfig(
  options: PiWsConfigLoaderOptions = {},
): Promise<PiWsConfig> {
  const env = options.env ?? process.env;
  const defaults = createDefaultOptions(env);
  const envOverrides = loadEnvOverrides(env);
  const mergedOverrides = mergeOptions(
    envOverrides,
    options.overrides ?? {},
    env,
  );

  const resolved = await loadC12Config<PiWsOptions>({
    name: 'pi-ws',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    configFile: options.configFile ?? 'pi-ws.config',
    rcFile: options.rcFile ?? false,
    globalRc: options.globalRc ?? false,
    packageJson: options.packageJson ?? ['pi-ws'],
    ...(options.envName === undefined ? {} : { envName: options.envName }),
    dotenv: options.dotenv ?? {
      fileName: ['.env', '.env.local'],
    },
    defaults,
    overrides: mergedOverrides,
    merger: (...sources) => mergeOptionsList(env, sources),
  });

  return resolveConfig(env, resolved.config);
}

/**
 * Creates the built-in default runtime config without reading config files.
 *
 * @remarks
 * This is mainly useful for embedding scenarios where you want the same
 * runtime defaults as `PiWs` itself but intend to configure the server
 * entirely in code.
 *
 * @param env - Environment forwarded to the spawned Pi subprocess by default.
 * @returns Fully-resolved default runtime configuration.
 * @public
 */
export function createDefaultConfig(
  env: NodeJS.ProcessEnv = process.env,
): PiWsConfig {
  return resolveConfig(env, createDefaultOptions(env));
}

function createDefaultOptions(env: NodeJS.ProcessEnv): PiWsOptions {
  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    wsPrefix: DEFAULT_WS_PREFIX,
    maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    chatExample: true,
    pi: {
      args: [],
      env: pickPiEnvironment(env),
    },
  };
}

function loadEnvOverrides(env: NodeJS.ProcessEnv): PiWsOptions {
  const tls = loadTlsConfig(env);
  const piAuth = loadPiAuth(env);
  const pi = loadPiOptions(env);

  return {
    ...optionalValue(optionalNonEmpty(env['PI_WS_HOST']), 'host'),
    ...optionalValue(parsePort(env['PI_WS_PORT']), 'port'),
    ...optionalValue(parsePrefix(env['PI_WS_PREFIX']), 'wsPrefix'),
    ...optionalValue(
      parsePositiveInteger(
        env['PI_WS_MAX_PAYLOAD_BYTES'],
        'PI_WS_MAX_PAYLOAD_BYTES',
      ),
      'maxPayloadBytes',
    ),
    ...optionalValue(
      parseBoolean(env['PI_WS_CHAT_EXAMPLE'], 'PI_WS_CHAT_EXAMPLE'),
      'chatExample',
    ),
    ...optionalValue(tls, 'tls'),
    ...optionalValue(piAuth, 'piAuth'),
    ...(isPiOptionsEmpty(pi) ? {} : { pi }),
  };
}

function loadPiOptions(env: NodeJS.ProcessEnv): PiProcessOptions {
  return {
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_COMMAND']), 'command'),
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_CWD']), 'cwd'),
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_AGENT_DIR']), 'agentDir'),
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_PROVIDER']), 'provider'),
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_MODEL']), 'model'),
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_THINKING']), 'thinking'),
    ...optionalValue(optionalNonEmpty(env['PI_WS_PI_NAME']), 'sessionName'),
    ...optionalValue(
      optionalNonEmpty(env['PI_WS_PI_SYSTEM_PROMPT']),
      'systemPrompt',
    ),
    ...optionalValue(parseArgs(env['PI_WS_PI_ARGS']), 'args'),
    ...optionalValue(
      parseStringList(
        env['PI_WS_PI_APPEND_SYSTEM_PROMPT'],
        'PI_WS_PI_APPEND_SYSTEM_PROMPT',
      ),
      'appendSystemPrompt',
    ),
    ...optionalValue(
      parseStringList(env['PI_WS_PI_EXTENSIONS'], 'PI_WS_PI_EXTENSIONS'),
      'extensions',
    ),
    ...optionalValue(
      parseStringList(
        env['PI_WS_PI_PROMPT_TEMPLATES'],
        'PI_WS_PI_PROMPT_TEMPLATES',
      ),
      'promptTemplates',
    ),
    env: pickPiEnvironment(env),
  };
}

function loadTlsConfig(env: NodeJS.ProcessEnv): PiWsTlsConfig | undefined {
  const keyFileName = optionalNonEmpty(env['PI_WS_TLS_KEY_FILE']);
  const certFileName = optionalNonEmpty(env['PI_WS_TLS_CERT_FILE']);

  if (keyFileName === undefined && certFileName === undefined) {
    return undefined;
  }

  if (keyFileName === undefined) {
    throw new Error('PI_WS_TLS_KEY_FILE is required when TLS is enabled');
  }

  if (certFileName === undefined) {
    throw new Error('PI_WS_TLS_CERT_FILE is required when TLS is enabled');
  }

  return {
    keyFileName,
    certFileName,
    ...optionalValue(optionalNonEmpty(env['PI_WS_TLS_CA_FILE']), 'caFileName'),
    ...optionalValue(
      optionalNonEmpty(env['PI_WS_TLS_PASSPHRASE']),
      'passphrase',
    ),
    ...optionalValue(
      optionalNonEmpty(env['PI_WS_TLS_DH_PARAMS_FILE']),
      'dhParamsFileName',
    ),
    ...optionalValue(optionalNonEmpty(env['PI_WS_TLS_CIPHERS']), 'sslCiphers'),
    ...optionalValue(
      parseBoolean(
        env['PI_WS_TLS_PREFER_LOW_MEMORY_USAGE'],
        'PI_WS_TLS_PREFER_LOW_MEMORY_USAGE',
      ),
      'preferLowMemoryUsage',
    ),
  };
}

function loadPiAuth(env: NodeJS.ProcessEnv): RequestAuthorizer | undefined {
  const token = optionalNonEmpty(env['PI_WS_AUTH_TOKEN']);
  if (token === undefined) return undefined;

  return createStaticTokenAuthorizer({
    token,
    header: optionalNonEmpty(env['PI_WS_AUTH_HEADER']) ?? 'authorization',
    scheme: optionalNonEmpty(env['PI_WS_AUTH_SCHEME']) ?? 'Bearer',
    ...optionalValue(
      optionalNonEmpty(env['PI_WS_AUTH_QUERY_PARAM']),
      'queryParam',
    ),
    ...optionalValue(optionalNonEmpty(env['PI_WS_AUTH_REALM']), 'realm'),
  });
}

function resolveConfig(
  env: NodeJS.ProcessEnv,
  config: PiWsOptions,
): PiWsConfig {
  return {
    host: config.host ?? DEFAULT_HOST,
    port: config.port ?? DEFAULT_PORT,
    wsPrefix: config.wsPrefix ?? DEFAULT_WS_PREFIX,
    maxPayloadBytes: config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    ...(config.tls === undefined ? {} : { tls: config.tls }),
    pi: resolvePiConfig(env, config.pi),
    ...(config.piAuth === undefined ? {} : { piAuth: config.piAuth }),
    chatExample: config.chatExample ?? true,
  };
}

function resolvePiConfig(
  env: NodeJS.ProcessEnv,
  config: PiProcessOptions | undefined,
): PiProcessConfig {
  return {
    args: config?.args ?? [],
    env: config?.env ?? pickPiEnvironment(env),
    ...optionalValue(config?.command, 'command'),
    ...optionalValue(config?.cwd, 'cwd'),
    ...optionalValue(config?.agentDir, 'agentDir'),
    ...optionalValue(config?.provider, 'provider'),
    ...optionalValue(config?.model, 'model'),
    ...optionalValue(config?.thinking, 'thinking'),
    ...optionalValue(config?.sessionName, 'sessionName'),
    ...optionalValue(config?.systemPrompt, 'systemPrompt'),
    ...optionalValue(config?.appendSystemPrompt, 'appendSystemPrompt'),
    ...optionalValue(config?.extensions, 'extensions'),
    ...optionalValue(config?.promptTemplates, 'promptTemplates'),
  };
}

function mergeOptions(
  base: PiWsOptions,
  override: PiWsOptions,
  env: NodeJS.ProcessEnv,
): PiWsOptions {
  const pi = mergePiOptions(base.pi, override.pi, env);

  return {
    ...base,
    ...override,
    ...(pi === undefined ? {} : { pi }),
    ...mergeOptionalObject(base, override, 'tls'),
    ...mergeOptionalObject(base, override, 'piAuth'),
  };
}

function mergeOptionsList(
  env: NodeJS.ProcessEnv,
  sources: (PiWsOptions | null | undefined)[],
): PiWsOptions {
  let resolved = createDefaultOptions(env);

  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (source === undefined || source === null) continue;
    resolved = mergeOptions(resolved, source, env);
  }

  return resolved;
}

function mergePiOptions(
  base: PiProcessOptions | undefined,
  override: PiProcessOptions | undefined,
  env: NodeJS.ProcessEnv,
): PiProcessOptions | undefined {
  if (base === undefined && override === undefined) {
    return undefined;
  }

  const merged = {
    ...(base ?? {}),
    ...(override ?? {}),
    env: override?.env ?? base?.env ?? pickPiEnvironment(env),
    args: override?.args ?? base?.args ?? [],
  } satisfies PiProcessOptions;

  return merged;
}

function mergeOptionalObject<
  Key extends 'tls' | 'piAuth',
  Value extends PiWsOptions[Key],
>(
  base: PiWsOptions,
  override: PiWsOptions,
  key: Key,
): Partial<Record<Key, Value>> {
  const value = override[key] ?? base[key];
  return value === undefined
    ? {}
    : ({ [key]: value } as Partial<Record<Key, Value>>);
}

function parsePort(value: string | undefined): number | undefined {
  return parsePositiveInteger(value, 'PI_WS_PORT');
}

function parsePrefix(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return normalizePrefix(value);
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseBoolean(
  value: string | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined || value.trim() === '') return undefined;

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
      throw new Error(`${name} must be a boolean`);
  }
}

function normalizePrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '/') return '';

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
}

function parseArgs(value: string | undefined): readonly string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    return [...parseStringArrayJson(trimmed, 'PI_WS_PI_ARGS')];
  }

  return trimmed.split(/\s+/u);
}

function parseStringList(
  value: string | undefined,
  name: string,
): readonly string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    return [...parseStringArrayJson(trimmed, name)];
  }

  return [trimmed];
}

function parseStringArrayJson(value: string, name: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'string')
  ) {
    throw new Error(`${name} JSON value must be a string array`);
  }

  return parsed as string[];
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

function optionalNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return value;
}

function optionalValue<Key extends string, Value>(
  value: Value | undefined,
  key: Key,
): Partial<Record<Key, Value>> {
  if (value === undefined) return {};
  return { [key]: value } as Partial<Record<Key, Value>>;
}

function isPiOptionsEmpty(config: PiProcessOptions): boolean {
  return Object.keys(config).length === 1 && config.env !== undefined;
}
