import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Logger } from 'pino';
import {
  DISABLED,
  type WebSocket,
  type WebSocketBehavior,
} from 'uWebSockets.js';
import {
  ArtifactManager,
  type ArtifactTransfer,
} from '../artifacts/artifact-manager.js';
import { PiRpcProcess } from '../pi/rpc-process.js';
import { preparePiLaunch } from '../pi/sandbox.js';
import {
  createMessageAuthInput,
  getWebSocketContext,
  protectWebSocketBehavior,
  runAuthHooks,
  setWebSocketContext,
} from '../server/auth.js';
import type {
  AuthorizationFailure,
  PiProcessConfig,
  PiWsArtifactConfig,
  PiWsHooks,
  PiWsSandboxConfig,
  RequestHookContext,
  WebSocketConnectionContext,
} from '../server/types.js';
import { parseJsonObject } from '../utils/jsonl.js';

interface PiWebSocketOptions<Session = unknown> {
  readonly artifacts: PiWsArtifactConfig;
  readonly logger: Logger;
  readonly pi: PiProcessConfig;
  readonly maxPayloadBytes: number;
  readonly sandbox: PiWsSandboxConfig;
  readonly hooks?: PiWsHooks<Session>;
}

interface PiSocketData<Session = unknown> {
  artifactManager?: ArtifactManager;
  authenticating: boolean;
  authenticated: boolean;
  authRequired: boolean;
  closed: boolean;
  connectionId: string;
  context: WebSocketConnectionContext<Session> | undefined;
  peer?: PiRpcProcess;
  sessionId: string;
}

export function createPiWebSocketRoute<Session = unknown>(
  options: PiWebSocketOptions<Session>,
): WebSocketBehavior<PiSocketData<Session>> {
  const authHooks = options.hooks?.onAuth ?? [];
  const authRequired = authHooks.length > 0;
  const routeLogger = options.logger.child({ component: 'pi-route' });

  const behavior: WebSocketBehavior<PiSocketData<Session>> = {
    compression: DISABLED,
    maxBackpressure: 1024 * 1024,
    maxPayloadLength: options.maxPayloadBytes,
    closeOnBackpressureLimit: true,
    sendPingsAutomatically: true,
    idleTimeout: 120,
    open(ws) {
      const data = ws.getUserData();
      data.connectionId ||= randomUUID();
      data.sessionId ||= createShortSessionId();
      data.authRequired = authRequired;
      data.closed = false;
      data.context = getWebSocketContext<PiSocketData<Session>, Session>(ws);
      data.authenticated =
        !data.authRequired || data.context?.authenticated === true;
      data.authenticating = false;
      routeLogger.info(
        {
          authRequired: data.authRequired,
          connectionId: data.connectionId,
          sessionId: data.sessionId,
        },
        'websocket connection opened',
      );
      sendTextEvent(ws, {
        type: 'pi_ws_session',
        connectionId: data.connectionId,
        sessionId: data.sessionId,
      });

      if (data.authenticated) {
        tryStartPeer({ options, ws });
        return;
      }

      sendTextEvent(ws, { type: 'pi_ws_auth_required' });
    },
    message(ws, message, isBinary) {
      if (isBinary) {
        sendTextEvent(ws, {
          type: 'pi_ws_error',
          message: 'Binary websocket messages are not supported',
        });
        return;
      }

      const data = ws.getUserData();
      const payload = Buffer.from(message).toString('utf8');

      if (!data.authenticated) {
        void authenticateFirstMessage({ payload, ws, options });
        return;
      }

      sendToPeer({ payload, ws });
    },
    close(ws) {
      const data = ws.getUserData();
      data.closed = true;
      routeLogger.info(
        {
          connectionId: data.connectionId,
          sessionId: data.sessionId,
        },
        'websocket connection closed',
      );
      data.peer?.close();
      delete data.peer;
      void data.artifactManager?.stop();
      delete data.artifactManager;
    },
  };

  if (options.hooks === undefined) {
    return behavior;
  }

  return protectWebSocketBehavior<PiSocketData<Session>, Session>({
    behavior,
    hooks: options.hooks.onRequest ?? [],
    authHooks,
    logger: routeLogger,
    createUserData: (_request, context): PiSocketData<Session> => ({
      closed: false,
      connectionId: randomUUID(),
      context,
      authenticated: !authRequired || context.authenticated,
      authRequired,
      authenticating: false,
      sessionId: createShortSessionId(),
    }),
  });
}

async function authenticateFirstMessage<Session>({
  payload,
  ws,
  options,
}: {
  payload: string;
  ws: WebSocket<PiSocketData<Session>>;
  options: PiWebSocketOptions<Session>;
}): Promise<void> {
  const data = ws.getUserData();
  if (data.authenticating) {
    sendTextEvent(ws, {
      type: 'pi_ws_error',
      message: 'Authentication is already in progress',
    });
    return;
  }

  data.authenticating = true;

  try {
    const message = parseJsonObject(payload);
    const isAuthMessage = message['type'] === 'pi_ws_auth';
    const context = data.context;

    if (context === undefined) {
      ws.end(1011, 'missing websocket context');
      return;
    }

    const hookContext: RequestHookContext<Session> = {
      locals: { ...context.locals },
      ...(context.session === undefined ? {} : { session: context.session }),
    };
    const auth = isAuthMessage
      ? createMessageAuthInput(context.request, message)
      : {
          source: 'message' as const,
          request: context.request,
          provided: false,
        };
    const result = await runAuthHooks({
      auth,
      context: hookContext,
      hooks: options.hooks?.onAuth ?? [],
    });

    if (!result.decision.authorized) {
      rejectWebSocketAuth({ decision: result.decision, ws });
      return;
    }

    if (!result.authenticated) {
      rejectWebSocketAuth({
        decision: {
          authorized: false,
          status: '401 Unauthorized',
          body: JSON.stringify({ error: 'unauthorized' }),
        },
        ws,
      });
      return;
    }

    const updatedContext: WebSocketConnectionContext<Session> = {
      request: context.request,
      locals: Object.freeze({ ...hookContext.locals }),
      authProvided: result.provided,
      authenticated: true,
      ...(hookContext.session === undefined
        ? {}
        : { session: hookContext.session }),
    };

    data.context = updatedContext;
    data.authenticated = true;
    setWebSocketContext(ws, updatedContext);
    tryStartPeer({ options, ws });

    if (!isAuthMessage) {
      sendToPeer({ payload, ws });
    }
  } catch (error) {
    sendTextEvent(ws, {
      type: 'pi_ws_error',
      message:
        error instanceof Error
          ? error.message
          : 'Invalid authentication message',
    });
    ws.end(1008, 'auth failed');
  } finally {
    data.authenticating = false;
  }
}

function tryStartPeer<Session>({
  options,
  ws,
}: {
  options: PiWebSocketOptions<Session>;
  ws: WebSocket<PiSocketData<Session>>;
}): void {
  try {
    startPeer({ options, ws });
  } catch (error) {
    sendTextEvent(ws, {
      type: 'pi_ws_error',
      message:
        error instanceof Error ? error.message : 'Failed to start Pi process',
    });
    ws.end(1011, 'pi start failed');
  }
}

function startPeer<Session>({
  options,
  ws,
}: {
  options: PiWebSocketOptions<Session>;
  ws: WebSocket<PiSocketData<Session>>;
}): void {
  const data = ws.getUserData();
  if (data.peer !== undefined) return;

  const sessionLogger = options.logger.child({
    connectionId: data.connectionId,
    sessionId: data.sessionId,
  });
  const routeLogger = sessionLogger.child({ component: 'pi-route' });
  const artifactRootDir = options.artifacts.enabled
    ? join(options.artifacts.dir, data.sessionId)
    : undefined;
  const launch = preparePiLaunch({
    artifactDir: artifactRootDir,
    connectionId: data.sessionId,
    logger: sessionLogger,
    pi: options.pi,
    sandbox: options.sandbox,
    serverRoot: process.cwd(),
  });

  routeLogger.info(
    {
      artifactDir: artifactRootDir,
      sandboxMode: options.sandbox.mode,
      sandboxCwd: launch.cwd,
      sessionRoot: launch.sessionRoot,
    },
    'starting Pi websocket session',
  );

  if (artifactRootDir !== undefined) {
    data.artifactManager = new ArtifactManager({
      callbacks: {
        onArtifact: async (artifact) =>
          sendArtifactOverWebSocket({
            artifact,
            config: options.artifacts,
            logger: routeLogger,
            ws,
          }),
        onSkip: ({ name, reason, relativePath, size }) => {
          sendTextEvent(ws, {
            type: 'pi_ws_artifact_skipped',
            name,
            reason,
            relativePath,
            size,
          });
        },
      },
      config: options.artifacts,
      logger: sessionLogger,
      rootDir: artifactRootDir,
    });
    data.artifactManager.start();
  }

  data.peer = new PiRpcProcess({
    handlers: {
      onMessage: (message) => {
        sendTextEvent(ws, message);
        void data.artifactManager?.poll();
      },
      onStderr: (chunk) => {
        sendTextEvent(ws, {
          type: 'pi_ws_stderr',
          data: chunk,
        });
        void data.artifactManager?.poll();
      },
      onExit: (code, signal) => {
        sendTextEvent(ws, {
          type: 'pi_ws_exit',
          code,
          signal,
        });

        if (!ws.getUserData().closed) {
          ws.end(1011, 'pi exited');
        }
      },
      onError: (error) => {
        routeLogger.error({ err: error }, 'Pi subprocess error');
        sendTextEvent(ws, {
          type: 'pi_ws_error',
          message: error.message,
        });
      },
    },
    launch,
  });

  sendTextEvent(ws, {
    type: 'pi_ws_ready',
    ...(launch.artifactDir === undefined
      ? {}
      : { artifactDirName: basename(launch.artifactDir) }),
    artifactsEnabled: launch.artifactDir !== undefined,
    connectionId: data.connectionId,
    sandboxMode: options.sandbox.mode,
    sessionId: data.sessionId,
  });

  routeLogger.info(
    {
      artifactDir: launch.artifactDir,
      sandboxMode: options.sandbox.mode,
      sandboxCwd: launch.cwd,
      sessionRoot: launch.sessionRoot,
    },
    'Pi websocket session ready',
  );
}

function sendToPeer<Session>({
  payload,
  ws,
}: {
  payload: string;
  ws: WebSocket<PiSocketData<Session>>;
}): void {
  const data = ws.getUserData();

  try {
    data.peer?.send(parseJsonObject(payload));
  } catch (error) {
    sendTextEvent(ws, {
      type: 'pi_ws_error',
      message:
        error instanceof Error
          ? error.message
          : 'Invalid JSON websocket message',
    });
  }
}

function rejectWebSocketAuth<Session>({
  decision,
  ws,
}: {
  decision: AuthorizationFailure;
  ws: WebSocket<PiSocketData<Session>>;
}): void {
  sendTextEvent(ws, {
    type: 'pi_ws_auth_failed',
    status: decision.status ?? '401 Unauthorized',
    ...(decision.body === undefined ? {} : { body: decision.body }),
  });
  ws.end(1008, 'auth failed');
}

async function sendArtifactOverWebSocket<Session>({
  artifact,
  config,
  logger,
  ws,
}: {
  artifact: ArtifactTransfer;
  config: PiWsArtifactConfig;
  logger: Logger;
  ws: WebSocket<PiSocketData<Session>>;
}): Promise<void> {
  const file = await open(
    artifact.absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let bytes: Buffer;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > config.maxFileBytes) {
      throw new Error('Artifact exceeds configured max file size');
    }

    bytes = await file.readFile();
    if (bytes.length > config.maxFileBytes) {
      throw new Error('Artifact exceeds configured max file size');
    }
  } finally {
    await file.close();
  }

  logger.info(
    {
      artifactId: artifact.id,
      bytes: bytes.length,
      mimeType: artifact.mimeType,
      name: artifact.name,
    },
    'sending websocket artifact',
  );

  if (bytes.length <= config.chunkSizeBytes) {
    sendTextEvent(ws, {
      type: 'pi_ws_artifact',
      id: artifact.id,
      mimeType: artifact.mimeType,
      name: artifact.name,
      relativePath: artifact.relativePath,
      size: bytes.length,
    });
    sendBinaryFrame(ws, bytes);
    return;
  }

  const chunks = Math.ceil(bytes.length / config.chunkSizeBytes);
  sendTextEvent(ws, {
    type: 'pi_ws_artifact_start',
    chunkSize: config.chunkSizeBytes,
    chunks,
    id: artifact.id,
    mimeType: artifact.mimeType,
    name: artifact.name,
    relativePath: artifact.relativePath,
    size: bytes.length,
  });

  for (let index = 0; index < chunks; index += 1) {
    const offset = index * config.chunkSizeBytes;
    const chunk = bytes.subarray(offset, offset + config.chunkSizeBytes);
    sendTextEvent(ws, {
      type: 'pi_ws_artifact_chunk',
      id: artifact.id,
      index,
      offset,
      size: chunk.length,
    });
    sendBinaryFrame(ws, chunk);
  }

  sendTextEvent(ws, {
    type: 'pi_ws_artifact_end',
    id: artifact.id,
  });
}

function sendTextEvent<Session>(
  ws: WebSocket<PiSocketData<Session>>,
  event: Record<string, unknown>,
): void {
  if (ws.getUserData().closed) return;
  const status = ws.send(JSON.stringify(event));
  if (status === 2) {
    ws.end(1013, 'backpressure');
  }
}

function sendBinaryFrame<Session>(
  ws: WebSocket<PiSocketData<Session>>,
  chunk: ArrayBufferView,
): void {
  if (ws.getUserData().closed) return;
  const status = ws.send(chunk, true);
  if (status === 2) {
    ws.end(1013, 'backpressure');
  }
}

function createShortSessionId(): string {
  return `s-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
