import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Logger } from 'pino';
import type { PiProcessConfig, PiWsSandboxConfig } from '../server/types.js';
import { resolvePiCommand } from './resolve-pi-command.js';

const ALWAYS_INCLUDED_ENV = ['LANG', 'LC_ALL', 'PATH', 'TERM', 'TZ'];
const MINIMAL_ENV_ALLOWLIST = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'COLORTERM',
  'FORCE_COLOR',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_BASE_URL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'MISTRAL_API_KEY',
  'MISTRAL_BASE_URL',
  'NO_COLOR',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'PI_API',
  'PI_API_KEY',
  'PI_BASE_URL',
  'PI_MODEL',
  'PI_PROVIDER',
  'PI_REASONING',
  'TMP',
  'TMPDIR',
  'TEMP',
];

export interface PreparedPiLaunch {
  readonly artifactDir?: string;
  readonly command: string;
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly promptHints: readonly string[];
  readonly resolvedCommandLine: readonly string[];
  readonly sessionRoot?: string;
}

export function preparePiLaunch({
  artifactDir,
  connectionId,
  logger,
  pi,
  sandbox,
  serverRoot,
}: {
  artifactDir: string | undefined;
  connectionId: string;
  logger: Logger;
  pi: PiProcessConfig;
  sandbox: PiWsSandboxConfig;
  serverRoot: string;
}): PreparedPiLaunch {
  const sandboxLogger = logger.child({
    component: 'pi-sandbox',
  });
  const sessionRoot =
    sandbox.mode === 'off' ? undefined : resolve(sandbox.cwd, connectionId);
  const promptHints = buildPromptHints({
    artifactDir,
    piCwd:
      sandbox.mode === 'off'
        ? pi.cwd
        : pi.cwd === undefined || pi.cwd.trim() === ''
          ? join(sessionRoot ?? resolve(sandbox.cwd, connectionId), 'cwd')
          : resolve(pi.cwd),
    sandbox,
    sessionRoot,
  });
  const resolved = resolvePiCommand({
    ...pi,
    appendSystemPrompt: [...(pi.appendSystemPrompt ?? []), ...promptHints],
  });

  if (sandbox.mode === 'off') {
    const env = buildOffModeEnvironment({
      artifactDir,
      pi,
      sandbox,
    });

    sandboxLogger.debug(
      { artifactDir, cwd: pi.cwd, mode: sandbox.mode },
      'prepared Pi launch without sandboxing',
    );
    return {
      ...(artifactDir === undefined ? {} : { artifactDir }),
      command: resolved.command,
      ...(pi.cwd === undefined ? {} : { cwd: pi.cwd }),
      env,
      promptHints,
      resolvedCommandLine: [resolved.command, ...resolved.args],
    };
  }

  if (sessionRoot === undefined) {
    throw new Error('sandbox session root was not initialized');
  }
  const sessionHome = join(sessionRoot, 'home');
  const sessionCwd = resolveSandboxCwd({
    configuredCwd: pi.cwd,
    fallbackCwd: join(sessionRoot, 'cwd'),
    sandbox,
    serverRoot,
  });
  const sessionTmp = join(sessionRoot, 'tmp');

  mkdirSync(sessionRoot, { recursive: true });
  mkdirSync(sessionHome, { recursive: true });
  mkdirSync(sessionCwd, { recursive: true });
  mkdirSync(sessionTmp, { recursive: true });

  const env = buildSandboxEnvironment({
    artifactDir,
    homeDir: sessionHome,
    pi,
    sandbox,
    sandboxCwd: sessionCwd,
    sessionRoot,
    tmpDir: sessionTmp,
  });

  if (sandbox.mode === 'system') {
    if (sandbox.command === undefined || sandbox.command.trim() === '') {
      throw new Error(
        'sandbox.command is required when sandbox.mode is "system"',
      );
    }

    const wrapperArgs = sandbox.args.map((arg) =>
      replaceSandboxPlaceholders({
        allowReadDirs: sandbox.allowReadDirs,
        allowWriteDirs: [
          ...sandbox.allowWriteDirs,
          sessionRoot,
          ...(artifactDir === undefined ? [] : [artifactDir]),
        ],
        artifactDir,
        input: arg,
        sandboxCwd: sessionCwd,
        sandboxHome: sessionHome,
        sessionRoot,
      }),
    );
    const commandLine = [
      sandbox.command,
      ...wrapperArgs,
      resolved.command,
      ...resolved.args,
    ];

    sandboxLogger.info(
      {
        artifactDir,
        cwd: sessionCwd,
        mode: sandbox.mode,
        sessionRoot,
        wrapperCommand: sandbox.command,
      },
      'prepared Pi launch with external sandbox wrapper',
    );
    return {
      ...(artifactDir === undefined ? {} : { artifactDir }),
      command: sandbox.command,
      cwd: sessionCwd,
      env,
      promptHints,
      resolvedCommandLine: commandLine,
      sessionRoot,
    };
  }

  sandboxLogger.info(
    {
      artifactDir,
      cwd: sessionCwd,
      mode: sandbox.mode,
      sessionRoot,
    },
    'prepared Pi launch with process sandbox',
  );
  return {
    ...(artifactDir === undefined ? {} : { artifactDir }),
    command: resolved.command,
    cwd: sessionCwd,
    env,
    promptHints,
    resolvedCommandLine: [resolved.command, ...resolved.args],
    sessionRoot,
  };
}

function buildOffModeEnvironment({
  artifactDir,
  pi,
  sandbox,
}: {
  artifactDir: string | undefined;
  pi: PiProcessConfig;
  sandbox: PiWsSandboxConfig;
}): Readonly<Record<string, string>> {
  const env = {
    ...pickPiEnvironmentForPolicy({ pi, sandbox }),
    ...sandbox.env,
  };

  if (pi.agentDir !== undefined && pi.agentDir.trim() !== '') {
    env['PI_CODING_AGENT_DIR'] = pi.agentDir;
  }

  if (artifactDir !== undefined) {
    env['PI_WS_ARTIFACT_DIR'] = artifactDir;
  }

  return env;
}

function buildSandboxEnvironment({
  artifactDir,
  homeDir,
  pi,
  sandbox,
  sandboxCwd,
  sessionRoot,
  tmpDir,
}: {
  artifactDir: string | undefined;
  homeDir: string;
  pi: PiProcessConfig;
  sandbox: PiWsSandboxConfig;
  sandboxCwd: string;
  sessionRoot: string;
  tmpDir: string;
}): Readonly<Record<string, string>> {
  const env = {
    ...pickPiEnvironmentForPolicy({ pi, sandbox }),
    ...sandbox.env,
  };

  env['HOME'] = homeDir;
  env['TMPDIR'] = tmpDir;
  env['TMP'] = tmpDir;
  env['TEMP'] = tmpDir;
  env['PI_WS_SANDBOX_MODE'] = sandbox.mode;
  env['PI_WS_SANDBOX_SESSION_ROOT'] = sessionRoot;
  env['PI_WS_SANDBOX_CWD'] = sandboxCwd;
  env['PI_WS_SANDBOX_ALLOW_READ_DIRS'] = JSON.stringify(sandbox.allowReadDirs);
  env['PI_WS_SANDBOX_ALLOW_WRITE_DIRS'] = JSON.stringify(
    artifactDir === undefined
      ? [...sandbox.allowWriteDirs, sessionRoot]
      : [...sandbox.allowWriteDirs, sessionRoot, artifactDir],
  );

  if (pi.agentDir !== undefined && pi.agentDir.trim() !== '') {
    env['PI_CODING_AGENT_DIR'] = pi.agentDir;
  }

  if (artifactDir !== undefined) {
    env['PI_WS_ARTIFACT_DIR'] = artifactDir;
  }

  return env;
}

function pickPiEnvironmentForPolicy({
  pi,
  sandbox,
}: {
  pi: PiProcessConfig;
  sandbox: PiWsSandboxConfig;
}): Record<string, string> {
  if (sandbox.envPolicy === 'inherit') {
    return { ...pi.env };
  }

  if (sandbox.envPolicy === 'allowlist') {
    return pickEnvironment(pi.env, [
      ...ALWAYS_INCLUDED_ENV,
      ...sandbox.envAllowlist,
    ]);
  }

  return pickEnvironment(pi.env, [
    ...ALWAYS_INCLUDED_ENV,
    ...MINIMAL_ENV_ALLOWLIST,
    ...sandbox.envAllowlist,
  ]);
}

function buildPromptHints({
  artifactDir,
  piCwd,
  sandbox,
  sessionRoot,
}: {
  artifactDir: string | undefined;
  piCwd: string | undefined;
  sandbox: PiWsSandboxConfig;
  sessionRoot: string | undefined;
}): readonly string[] {
  const hints: string[] = [];

  if (artifactDir !== undefined) {
    hints.push(
      [
        `Artifact output is enabled at ${artifactDir}.`,
        'Treat user requests to draw, plot, chart, render, show, display, create, export, attach, download, save, or output non-text content as artifact requests even when the user does not mention files or environment variables.',
        `For every generated image, chart, plot, PDF, CSV, archive, audio, video, or other file meant for the user, write the finished file directly into the exact absolute artifact directory ${artifactDir} using a stable filename with a useful extension.`,
        'When writing code, read the destination from PI_WS_ARTIFACT_DIR or use the exact absolute artifact directory above.',
        'Do not invent relative artifact paths such as ./artifacts, ../artifacts, cwd/artifacts, output/artifacts, or a nested directory named after the session id.',
        'Do not rely on GUI display calls, browser-only display helpers, pi.show, plt.show, or other interactive viewers for artifacts; produce real files instead.',
        'If a command fails because a tool or language package is missing, treat that as recoverable: install the dependency into the sandbox using the language package manager or a sandbox-local virtual environment, then retry. If installation is unavailable, use a dependency-free fallback that still writes the requested artifact file.',
        'In the final response, be concise: state that the artifact was created and mention only the generated filename after it has been fully written inside PI_WS_ARTIFACT_DIR.',
        'Do not print absolute artifact paths, local filesystem paths, code blocks containing paths, or generic follow-up offers for artifacts because the websocket client displays and links them separately.',
      ].join(' '),
    );
  }

  if (sandbox.mode !== 'off') {
    const writable = [
      ...sandbox.allowWriteDirs,
      ...(sessionRoot === undefined ? [] : [sessionRoot]),
      ...(artifactDir === undefined ? [] : [artifactDir]),
    ];
    hints.push(
      `Your working directory is ${piCwd ?? '(unset)'}. Only use files inside the explicitly allowed directories. Allowed read directories: ${formatPromptDirList(sandbox.allowReadDirs)}. Allowed write directories: ${formatPromptDirList(writable)}.`,
    );
    hints.push(
      'Package installs, package caches, virtual environments, tool configs, and temporary files must stay inside HOME, TMPDIR, the session root, or the artifact directory. Do not write to system locations or the server workspace. If a dependency is missing, install it inside those writable sandbox locations or use a no-dependency fallback rather than asking the user to run code elsewhere.',
    );
  }

  return hints;
}

function resolveSandboxCwd({
  configuredCwd,
  fallbackCwd,
  sandbox,
  serverRoot,
}: {
  configuredCwd: string | undefined;
  fallbackCwd: string;
  sandbox: PiWsSandboxConfig;
  serverRoot: string;
}): string {
  const candidate =
    configuredCwd === undefined || configuredCwd.trim() === ''
      ? fallbackCwd
      : resolve(configuredCwd);
  const sandboxRoot = resolve(sandbox.cwd);

  if (
    sandbox.denyServerDirectory &&
    isPathInsideDirectory(candidate, serverRoot) &&
    !isPathInsideDirectory(candidate, sandboxRoot)
  ) {
    throw new Error(
      `sandboxed Pi cwd must not point into the server workspace: ${candidate}`,
    );
  }

  return candidate;
}

function pickEnvironment(
  env: Readonly<Record<string, string>>,
  names: readonly string[],
): Record<string, string> {
  const unique = new Set(names);
  const selected: Record<string, string> = {};

  for (const name of unique) {
    const value = env[name];
    if (value !== undefined && value !== '') {
      selected[name] = value;
    }
  }

  return selected;
}

function replaceSandboxPlaceholders({
  allowReadDirs,
  allowWriteDirs,
  artifactDir,
  input,
  sandboxCwd,
  sandboxHome,
  sessionRoot,
}: {
  allowReadDirs: readonly string[];
  allowWriteDirs: readonly string[];
  artifactDir: string | undefined;
  input: string;
  sandboxCwd: string;
  sandboxHome: string;
  sessionRoot: string;
}): string {
  return input
    .replaceAll('{allowReadDirs}', allowReadDirs.join(':'))
    .replaceAll('{allowWriteDirs}', allowWriteDirs.join(':'))
    .replaceAll('{artifactDir}', artifactDir ?? '')
    .replaceAll('{sandboxCwd}', sandboxCwd)
    .replaceAll('{sandboxHome}', sandboxHome)
    .replaceAll('{sessionRoot}', sessionRoot);
}

function formatPromptDirList(entries: readonly string[]): string {
  return entries.length === 0 ? 'none' : entries.join(', ');
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path));
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}
