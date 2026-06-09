import {
  DISABLED,
  type WebSocket,
  type WebSocketBehavior,
} from 'uWebSockets.js';
import { startPiRpcProcess, type PiRpcProcess } from '../pi/rpc-process.js';
import type { PiProcessConfig } from '../server/types.js';
import { parseJsonObject } from '../utils/jsonl.js';

interface PiWebSocketOptions {
  readonly pi: PiProcessConfig;
  readonly maxPayloadBytes: number;
}

interface PiSocketData {
  peer?: PiRpcProcess;
  closed: boolean;
}

export function createPiWebSocketRoute(
  options: PiWebSocketOptions,
): WebSocketBehavior<PiSocketData> {
  return {
    compression: DISABLED,
    maxBackpressure: 1024 * 1024,
    maxPayloadLength: options.maxPayloadBytes,
    closeOnBackpressureLimit: true,
    sendPingsAutomatically: true,
    idleTimeout: 120,
    open(ws) {
      const data = ws.getUserData();
      data.closed = false;
      data.peer = startPiRpcProcess(options.pi, {
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
      });

      sendEvent(ws, { type: 'pi_ws_ready' });
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
    },
    close(ws) {
      const data = ws.getUserData();
      data.closed = true;
      data.peer?.close();
      delete data.peer;
    },
  };
}

function sendEvent(
  ws: WebSocket<PiSocketData>,
  event: Record<string, unknown>,
): void {
  if (ws.getUserData().closed) return;

  const status = ws.send(JSON.stringify(event));
  if (status === 2) {
    ws.end(1013, 'backpressure');
  }
}
