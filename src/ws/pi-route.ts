import {
  DISABLED,
  type WebSocket,
  type WebSocketBehavior,
} from 'uWebSockets.js';
import { PiRpcProcess } from '../pi/rpc-process.js';
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
  PiWsHooks,
  RequestHookContext,
  WebSocketConnectionContext,
} from '../server/types.js';
import { parseJsonObject } from '../utils/jsonl.js';

interface PiWebSocketOptions<Session = unknown> {
  readonly pi: PiProcessConfig;
  readonly maxPayloadBytes: number;
  readonly hooks?: PiWsHooks<Session>;
}

interface PiSocketData<Session = unknown> {
  peer?: PiRpcProcess;
  context: WebSocketConnectionContext<Session> | undefined;
  closed: boolean;
  authenticated: boolean;
  authRequired: boolean;
  authenticating: boolean;
}

export function createPiWebSocketRoute<Session = unknown>(
  options: PiWebSocketOptions<Session>,
): WebSocketBehavior<PiSocketData<Session>> {
  const authHooks = options.hooks?.onAuth ?? [];
  const authRequired = authHooks.length > 0;

  const behavior: WebSocketBehavior<PiSocketData<Session>> = {
    compression: DISABLED,
    maxBackpressure: 1024 * 1024,
    maxPayloadLength: options.maxPayloadBytes,
    closeOnBackpressureLimit: true,
    sendPingsAutomatically: true,
    idleTimeout: 120,
    open(ws) {
      const data = ws.getUserData();
      data.closed = false;
      data.context = getWebSocketContext<PiSocketData<Session>, Session>(ws);
      data.authenticated =
        !data.authRequired || data.context?.authenticated === true;
      data.authenticating = false;

      if (data.authenticated) {
        startPeer({ options, ws });
        return;
      }

      sendEvent(ws, { type: 'pi_ws_auth_required' });
    },
    message(ws, message, isBinary) {
      if (isBinary) {
        sendEvent(ws, {
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
      data.peer?.close();
      delete data.peer;
    },
  };

  if (options.hooks === undefined) {
    return behavior;
  }

  return protectWebSocketBehavior<PiSocketData<Session>, Session>({
    behavior,
    hooks: options.hooks.onRequest ?? [],
    authHooks,
    createUserData: (_request, context): PiSocketData<Session> => ({
      closed: false,
      context,
      authenticated: !authRequired || context.authenticated,
      authRequired,
      authenticating: false,
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
    sendEvent(ws, {
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
    startPeer({ options, ws });

    if (!isAuthMessage) {
      sendToPeer({ payload, ws });
    }
  } catch (error) {
    sendEvent(ws, {
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

function startPeer<Session>({
  options,
  ws,
}: {
  options: PiWebSocketOptions<Session>;
  ws: WebSocket<PiSocketData<Session>>;
}): void {
  const data = ws.getUserData();
  if (data.peer !== undefined) return;

  data.peer = new PiRpcProcess({
    config: options.pi,
    handlers: {
      onMessage: (message) => {
        sendEvent(ws, message);
      },
      onStderr: (chunk) => {
        sendEvent(ws, {
          type: 'pi_ws_stderr',
          data: chunk,
        });
      },
      onExit: (code, signal) => {
        sendEvent(ws, {
          type: 'pi_ws_exit',
          code,
          signal,
        });

        if (!ws.getUserData().closed) {
          ws.end(1011, 'pi exited');
        }
      },
      onError: (error) => {
        sendEvent(ws, {
          type: 'pi_ws_error',
          message: error.message,
        });
      },
    },
  });

  sendEvent(ws, { type: 'pi_ws_ready' });
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
    sendEvent(ws, {
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
  sendEvent(ws, {
    type: 'pi_ws_auth_failed',
    status: decision.status ?? '401 Unauthorized',
    ...(decision.body === undefined ? {} : { body: decision.body }),
  });
  ws.end(1008, 'auth failed');
}

function sendEvent<Session>(
  ws: WebSocket<PiSocketData<Session>>,
  event: Record<string, unknown>,
): void {
  if (ws.getUserData().closed) return;

  const status = ws.send(JSON.stringify(event));
  if (status === 2) {
    ws.end(1013, 'backpressure');
  }
}
