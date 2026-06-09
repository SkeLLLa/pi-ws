import { resolve } from 'node:path';
import {
  createDefineConfig as createC12DefineConfig,
  loadConfig as loadC12Config,
  type DotenvOptions,
} from 'c12';
import { createStaticTokenAuthHook } from './auth.js';
import type {
  PiProcessConfig,
  PiProcessOptions,
  PiWsArtifactConfig,
  PiWsArtifactOptions,
  PiWsConfig,
  PiWsHooks,
  PiWsOptions,
  PiWsSandboxConfig,
  PiWsSandboxOptions,
  PiWsTlsConfig,
} from './types.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_WS_PREFIX = '/ws';
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_ARTIFACTS_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_ARTIFACTS_CHUNK_SIZE_BYTES = 256 * 1024;
const DEFAULT_ARTIFACTS_SCAN_INTERVAL_MS = 500;
const DEFAULT_ARTIFACTS_STABILITY_WINDOW_MS = 500;
const DEFAULT_ARTIFACTS_LOG_LEVEL = 'silent';
const DEFAULT_SANDBOX_MODE = 'process';
const DEFAULT_SANDBOX_ENV_POLICY = 'minimal';

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
  const cwd = options.cwd ?? process.cwd();
  const resolver = new ConfigResolver({ cwd, env });
  const defaults = resolver.defaults();
  const envOverrides = resolver.loadEnvOverrides();
  const mergedOverrides = resolver.merge({
    base: envOverrides,
    override: options.overrides ?? {},
  });

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
    merger: (...sources) => resolver.mergeList(sources),
  });

  return resolver.resolve(resolved.config);
}

export function createDefaultConfig(
  env: NodeJS.ProcessEnv = process.env,
): PiWsConfig {
  const resolver = new ConfigResolver({ cwd: process.cwd(), env });
  return resolver.resolve(resolver.defaults());
}

class ConfigResolver {
  readonly #cwd: string;
  readonly #env: NodeJS.ProcessEnv;

  constructor({ cwd, env }: { cwd: string; env: NodeJS.ProcessEnv }) {
    this.#cwd = cwd;
    this.#env = env;
  }

  defaults(): PiWsOptions {
    return {
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      wsPrefix: DEFAULT_WS_PREFIX,
      maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
      chatExample: true,
      pi: {
        args: [],
        env: pickPiEnvironment(this.#env),
      },
      artifacts: {
        enabled: true,
        dir: resolve(this.#cwd, '.pi-ws/artifacts'),
        maxFileBytes: DEFAULT_ARTIFACTS_MAX_FILE_BYTES,
        chunkSizeBytes: DEFAULT_ARTIFACTS_CHUNK_SIZE_BYTES,
        scanIntervalMs: DEFAULT_ARTIFACTS_SCAN_INTERVAL_MS,
        stabilityWindowMs: DEFAULT_ARTIFACTS_STABILITY_WINDOW_MS,
        logLevel: DEFAULT_ARTIFACTS_LOG_LEVEL,
      },
      sandbox: {
        mode: DEFAULT_SANDBOX_MODE,
        cwd: resolve(this.#cwd, '.pi-ws/sandbox'),
        allowReadDirs: [],
        allowWriteDirs: [],
        envPolicy: DEFAULT_SANDBOX_ENV_POLICY,
        envAllowlist: [],
        env: {},
        denyServerDirectory: true,
        args: [],
      },
    };
  }

  loadEnvOverrides(): PiWsOptions {
    const env = this.#env;
    const tls = loadTlsConfig(env);
    const piHooks = loadPiHooks(env);
    const pi = loadPiOptions(env);
    const artifacts = loadArtifactOptions(env, this.#cwd);
    const sandbox = loadSandboxOptions(env, this.#cwd);

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
      ...optionalValue(piHooks, 'piHooks'),
      ...(isArtifactOptionsEmpty(artifacts) ? {} : { artifacts }),
      ...(isSandboxOptionsEmpty(sandbox) ? {} : { sandbox }),
      ...(isPiOptionsEmpty(pi) ? {} : { pi }),
    };
  }

  resolve(config: PiWsOptions): PiWsConfig {
    return {
      host: config.host ?? DEFAULT_HOST,
      port: config.port ?? DEFAULT_PORT,
      wsPrefix: config.wsPrefix ?? DEFAULT_WS_PREFIX,
      maxPayloadBytes: config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
      ...(config.tls === undefined ? {} : { tls: config.tls }),
      pi: resolvePiConfig(this.#env, config.pi),
      artifacts: resolveArtifactConfig(this.#cwd, config.artifacts),
      sandbox: resolveSandboxConfig(this.#cwd, config.sandbox),
      ...(config.piHooks === undefined ? {} : { piHooks: config.piHooks }),
      chatExample: config.chatExample ?? true,
    };
  }

  merge({
    base,
    override,
  }: {
    base: PiWsOptions;
    override: PiWsOptions;
  }): PiWsOptions {
    const pi = mergePiOptions(base.pi, override.pi, this.#env);

    return {
      ...base,
      ...override,
      ...(pi === undefined ? {} : { pi }),
      ...mergeOptionalObject(base, override, 'artifacts'),
      ...mergeOptionalObject(base, override, 'sandbox'),
      ...mergeOptionalObject(base, override, 'tls'),
      ...mergePiHooks(base.piHooks, override.piHooks),
    };
  }

  mergeList(sources: (PiWsOptions | null | undefined)[]): PiWsOptions {
    let resolved = this.defaults();

    for (let index = sources.length - 1; index >= 0; index -= 1) {
      const source = sources[index];
      if (source === undefined || source === null) continue;
      resolved = this.merge({ base: resolved, override: source });
    }

    return resolved;
  }
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

function loadArtifactOptions(
  env: NodeJS.ProcessEnv,
  cwd: string,
): PiWsArtifactOptions {
  return {
    ...optionalValue(
      parseBoolean(env['PI_WS_ARTIFACTS_ENABLED'], 'PI_WS_ARTIFACTS_ENABLED'),
      'enabled',
    ),
    ...optionalValue(
      resolveOptionalPath(env['PI_WS_ARTIFACTS_DIR'], cwd),
      'dir',
    ),
    ...optionalValue(
      parsePositiveInteger(
        env['PI_WS_ARTIFACTS_MAX_FILE_BYTES'],
        'PI_WS_ARTIFACTS_MAX_FILE_BYTES',
      ),
      'maxFileBytes',
    ),
    ...optionalValue(
      parsePositiveInteger(
        env['PI_WS_ARTIFACTS_CHUNK_SIZE_BYTES'],
        'PI_WS_ARTIFACTS_CHUNK_SIZE_BYTES',
      ),
      'chunkSizeBytes',
    ),
    ...optionalValue(
      parsePositiveInteger(
        env['PI_WS_ARTIFACTS_SCAN_INTERVAL_MS'],
        'PI_WS_ARTIFACTS_SCAN_INTERVAL_MS',
      ),
      'scanIntervalMs',
    ),
    ...optionalValue(
      parsePositiveInteger(
        env['PI_WS_ARTIFACTS_STABILITY_WINDOW_MS'],
        'PI_WS_ARTIFACTS_STABILITY_WINDOW_MS',
      ),
      'stabilityWindowMs',
    ),
    ...optionalValue(
      parseLogLevel(env['PI_WS_ARTIFACTS_LOG_LEVEL']),
      'logLevel',
    ),
    ...optionalValue(
      resolveOptionalPath(env['PI_WS_ARTIFACTS_LOG_FILE'], cwd),
      'logFile',
    ),
  };
}

function loadSandboxOptions(
  env: NodeJS.ProcessEnv,
  cwd: string,
): PiWsSandboxOptions {
  return {
    ...optionalValue(parseSandboxMode(env['PI_WS_SANDBOX_MODE']), 'mode'),
    ...optionalValue(resolveOptionalPath(env['PI_WS_SANDBOX_CWD'], cwd), 'cwd'),
    ...optionalValue(
      parsePathList(env['PI_WS_SANDBOX_ALLOW_READ_DIRS'], cwd),
      'allowReadDirs',
    ),
    ...optionalValue(
      parsePathList(env['PI_WS_SANDBOX_ALLOW_WRITE_DIRS'], cwd),
      'allowWriteDirs',
    ),
    ...optionalValue(
      parseSandboxEnvPolicy(env['PI_WS_SANDBOX_ENV_POLICY']),
      'envPolicy',
    ),
    ...optionalValue(
      parseStringList(
        env['PI_WS_SANDBOX_ENV_ALLOWLIST'],
        'PI_WS_SANDBOX_ENV_ALLOWLIST',
      ),
      'envAllowlist',
    ),
    ...optionalValue(
      parseStringRecord(env['PI_WS_SANDBOX_ENV'], 'PI_WS_SANDBOX_ENV'),
      'env',
    ),
    ...optionalValue(
      parseBoolean(
        env['PI_WS_SANDBOX_DENY_SERVER_DIRECTORY'],
        'PI_WS_SANDBOX_DENY_SERVER_DIRECTORY',
      ),
      'denyServerDirectory',
    ),
    ...optionalValue(optionalNonEmpty(env['PI_WS_SANDBOX_COMMAND']), 'command'),
    ...optionalValue(parseArgs(env['PI_WS_SANDBOX_ARGS']), 'args'),
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

function loadPiHooks(env: NodeJS.ProcessEnv): PiWsHooks | undefined {
  const token = optionalNonEmpty(env['PI_WS_AUTH_TOKEN']);
  if (token === undefined) return undefined;

  return {
    onAuth: [
      createStaticTokenAuthHook({
        token,
        header: optionalNonEmpty(env['PI_WS_AUTH_HEADER']) ?? 'authorization',
        scheme: optionalNonEmpty(env['PI_WS_AUTH_SCHEME']) ?? 'Bearer',
        ...optionalValue(
          optionalNonEmpty(env['PI_WS_AUTH_QUERY_PARAM']),
          'queryParam',
        ),
        ...optionalValue(optionalNonEmpty(env['PI_WS_AUTH_REALM']), 'realm'),
      }),
    ],
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

function resolveArtifactConfig(
  cwd: string,
  config: PiWsArtifactOptions | undefined,
): PiWsArtifactConfig {
  return {
    enabled: config?.enabled ?? true,
    dir: resolvePath(config?.dir ?? '.pi-ws/artifacts', cwd),
    maxFileBytes: config?.maxFileBytes ?? DEFAULT_ARTIFACTS_MAX_FILE_BYTES,
    chunkSizeBytes:
      config?.chunkSizeBytes ?? DEFAULT_ARTIFACTS_CHUNK_SIZE_BYTES,
    scanIntervalMs:
      config?.scanIntervalMs ?? DEFAULT_ARTIFACTS_SCAN_INTERVAL_MS,
    stabilityWindowMs:
      config?.stabilityWindowMs ?? DEFAULT_ARTIFACTS_STABILITY_WINDOW_MS,
    logLevel: config?.logLevel ?? DEFAULT_ARTIFACTS_LOG_LEVEL,
    ...optionalValue(
      config?.logFile === undefined
        ? undefined
        : resolvePath(config.logFile, cwd),
      'logFile',
    ),
  };
}

function resolveSandboxConfig(
  cwd: string,
  config: PiWsSandboxOptions | undefined,
): PiWsSandboxConfig {
  return {
    mode: config?.mode ?? DEFAULT_SANDBOX_MODE,
    cwd: resolvePath(config?.cwd ?? '.pi-ws/sandbox', cwd),
    allowReadDirs: (config?.allowReadDirs ?? []).map((entry) =>
      resolvePath(entry, cwd),
    ),
    allowWriteDirs: (config?.allowWriteDirs ?? []).map((entry) =>
      resolvePath(entry, cwd),
    ),
    envPolicy: config?.envPolicy ?? DEFAULT_SANDBOX_ENV_POLICY,
    envAllowlist: config?.envAllowlist ?? [],
    env: config?.env ?? {},
    denyServerDirectory: config?.denyServerDirectory ?? true,
    ...optionalValue(config?.command, 'command'),
    args: config?.args ?? [],
  };
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
  Key extends 'artifacts' | 'sandbox' | 'tls',
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

function mergePiHooks<Session = unknown>(
  base: PiWsOptions<Session>['piHooks'],
  override: PiWsOptions<Session>['piHooks'],
): Pick<PiWsOptions<Session>, 'piHooks'> | Record<string, never> {
  if (base === undefined && override === undefined) {
    return {};
  }

  return {
    piHooks: {
      onRequest: [...(base?.onRequest ?? []), ...(override?.onRequest ?? [])],
      onAuth: [...(base?.onAuth ?? []), ...(override?.onAuth ?? [])],
    },
  };
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

function parsePathList(
  value: string | undefined,
  cwd: string,
): readonly string[] | undefined {
  const parsed = parseStringList(value, 'path list');
  return parsed?.map((entry) => resolvePath(entry, cwd));
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

function parseStringRecord(
  value: string | undefined,
  name: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.entries(parsed).some(
      (entry) => typeof entry[0] !== 'string' || typeof entry[1] !== 'string',
    )
  ) {
    throw new Error(`${name} JSON value must be an object of strings`);
  }

  return parsed as Readonly<Record<string, string>>;
}

function parseSandboxMode(
  value: string | undefined,
): PiWsSandboxConfig['mode'] | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const trimmed = value.trim();
  switch (trimmed) {
    case 'off':
      return 'off';
    case 'process':
      return 'process';
    case 'system':
      return 'system';
    default:
      throw new Error(
        'PI_WS_SANDBOX_MODE must be one of: off, process, system',
      );
  }
}

function parseSandboxEnvPolicy(
  value: string | undefined,
): PiWsSandboxConfig['envPolicy'] | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const trimmed = value.trim();
  switch (trimmed) {
    case 'inherit':
      return 'inherit';
    case 'minimal':
      return 'minimal';
    case 'allowlist':
      return 'allowlist';
    default:
      throw new Error(
        'PI_WS_SANDBOX_ENV_POLICY must be one of: inherit, minimal, allowlist',
      );
  }
}

function parseLogLevel(
  value: string | undefined,
): PiWsArtifactConfig['logLevel'] | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const trimmed = value.trim();
  switch (trimmed) {
    case 'trace':
      return 'trace';
    case 'debug':
      return 'debug';
    case 'info':
      return 'info';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'fatal':
      return 'fatal';
    case 'silent':
      return 'silent';
    default:
      throw new Error(
        'PI_WS_ARTIFACTS_LOG_LEVEL must be one of: trace, debug, info, warn, error, fatal, silent',
      );
  }
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

function resolveOptionalPath(
  value: string | undefined,
  cwd: string,
): string | undefined {
  const normalized = optionalNonEmpty(value);
  return normalized === undefined ? undefined : resolvePath(normalized, cwd);
}

function resolvePath(value: string, cwd: string): string {
  return resolve(cwd, value);
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

function isArtifactOptionsEmpty(config: PiWsArtifactOptions): boolean {
  return Object.keys(config).length === 0;
}

function isPiOptionsEmpty(config: PiProcessOptions): boolean {
  return Object.keys(config).length === 1 && config.env !== undefined;
}

function isSandboxOptionsEmpty(config: PiWsSandboxOptions): boolean {
  return Object.keys(config).length === 0;
}
