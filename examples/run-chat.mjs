import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createStaticTokenAuthHook, PiWs } from '../dist/index.js';

const providerApiKeyEnv = {
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const providerBaseUrlEnv = {
  anthropic: 'ANTHROPIC_BASE_URL',
  google: 'GOOGLE_BASE_URL',
  mistral: 'MISTRAL_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
};

const root = resolve(import.meta.dirname, '..');

loadEnvFiles(root);

const host = process.env.PI_WS_HOST ?? '127.0.0.1';
const port = Number(process.env.PI_WS_PORT ?? '8787');
const provider = process.env.PI_PROVIDER ?? 'openai';
const baseUrl = resolveBaseUrl(provider);
const model = process.env.PI_MODEL;
const authToken = process.env.PI_WS_AUTH_TOKEN;
const authQueryParam = process.env.PI_WS_AUTH_QUERY_PARAM ?? 'token';
const sessionDir =
  process.env.PI_CODING_AGENT_SESSION_DIR ??
  resolve(root, '.tmp/pi-ws-example/sessions');

configureApiKey(provider);

if (baseUrl !== undefined && baseUrl !== '') {
  configureCustomModels({
    agentDir:
      process.env.PI_CODING_AGENT_DIR ??
      resolve(root, '.tmp/pi-ws-example/agent'),
    api: process.env.PI_API ?? 'openai-completions',
    apiKey: resolveApiKeyRef(provider),
    baseUrl,
    model,
    provider,
  });
}

mkdirSync(sessionDir, { recursive: true });
process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir;

const piArgs = ['--mode', 'rpc', '--no-session', '--session-dir', sessionDir];
if (provider !== '') piArgs.push('--provider', provider);
if (model !== undefined && model !== '') piArgs.push('--model', model);

const pipe = new PiWs({
  host,
  port,
  pi: {
    args: piArgs,
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry) => entry[1] !== undefined),
    ),
  },
});

if (authToken !== undefined && authToken !== '') {
  pipe.addHook(
    'onAuth',
    createStaticTokenAuthHook({
      token: authToken,
      queryParam: authQueryParam,
      createSession: async (request) => ({
        authenticatedAt: new Date().toISOString(),
        clientAddress: request.remoteAddress ?? 'unknown',
      }),
    }),
  );
}

const server = await pipe.listen();

console.log(
  `pi-ws example: http://${host}:${String(server.port)}/examples/chat/`,
);
console.log(`pi rpc websocket: ws://${host}:${String(server.port)}/ws/pi`);
console.log(`provider: ${provider}`);
console.log(`model: ${model ?? '(Pi default for provider)'}`);
if (authToken !== undefined && authToken !== '') {
  console.log(`auth: enabled with PI_WS_AUTH_TOKEN`);
  console.log(
    `browser auth: send {"type":"pi_ws_auth","token":"..." } as the first message`,
  );
  console.log(
    `query auth: ws://${host}:${String(server.port)}/ws/pi?${authQueryParam}=...`,
  );
}
if (baseUrl !== undefined && baseUrl !== '') {
  console.log(`base url: ${baseUrl}`);
  console.log(`pi config dir: ${process.env.PI_CODING_AGENT_DIR}`);
}

const stop = () => {
  pipe.close();
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

function configureApiKey(providerName) {
  const genericApiKey = process.env.PI_API_KEY;
  if (genericApiKey === undefined || genericApiKey === '') return;

  const envName = providerApiKeyEnv[providerName];
  if (envName !== undefined && process.env[envName] === undefined) {
    process.env[envName] = genericApiKey;
  }
}

function configureCustomModels({
  agentDir,
  api,
  apiKey,
  baseUrl,
  model,
  provider,
}) {
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const providerConfig = {
    baseUrl,
    api,
    apiKey,
  };

  if (model !== undefined && model !== '') {
    providerConfig.models = [
      {
        id: model,
        input: ['text'],
        reasoning: process.env.PI_REASONING === '1',
      },
    ];
  }

  writeFileSync(
    resolve(agentDir, 'models.json'),
    `${JSON.stringify({ providers: { [provider]: providerConfig } }, null, 2)}\n`,
  );
}

function resolveApiKeyRef(providerName) {
  if (process.env.PI_API_KEY !== undefined && process.env.PI_API_KEY !== '') {
    return '$PI_API_KEY';
  }

  const envName = providerApiKeyEnv[providerName];
  return envName === undefined ? '$PI_API_KEY' : `$${envName}`;
}

function resolveBaseUrl(providerName) {
  if (process.env.PI_BASE_URL !== undefined && process.env.PI_BASE_URL !== '') {
    return process.env.PI_BASE_URL;
  }

  const envName = providerBaseUrlEnv[providerName];
  if (envName === undefined) return undefined;

  const value = process.env[envName];
  return value === '' ? undefined : value;
}

function loadEnvFiles(directory) {
  const shellEnv = new Map(Object.entries(process.env));

  loadDotenv({ path: resolve(directory, '.env'), quiet: true });
  loadDotenv({
    path: resolve(directory, '.env.local'),
    quiet: true,
    override: true,
  });

  for (const [key, value] of shellEnv) {
    process.env[key] = value;
  }
}
