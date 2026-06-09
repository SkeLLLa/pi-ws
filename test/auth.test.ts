import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  composeHooks,
  createMessageAuthInput,
  createRequestAuthInput,
  createStaticTokenAuthHook,
  getWebSocketContext,
  getWebSocketSession,
  protectWebSocketBehavior,
  StaticTokenAuthorizer,
} from '../src/server/auth.js';
import type {
  AuthorizationRequest,
  RequestHookContext,
} from '../src/server/types.js';

const baseRequest: AuthorizationRequest = {
  method: 'GET',
  path: '/ws/pi',
  query: '',
  url: '/ws/pi',
  queryParams: {},
  headers: {},
};

void test('createStaticTokenAuthHook accepts bearer token header', async () => {
  const authorize = createStaticTokenAuthHook({
    token: 'secret',
  });

  assert.equal(
    (
      await authorize(
        createRequestAuthInput({
          ...baseRequest,
          headers: { authorization: 'Bearer secret' },
        }),
        { locals: {} },
      )
    )?.authorized !== false,
    true,
  );
});

void test('createStaticTokenAuthHook accepts configured query token', async () => {
  const authorize = createStaticTokenAuthHook({
    token: 'secret',
    queryParam: 'token',
  });

  assert.equal(
    (
      await authorize(
        createRequestAuthInput({
          ...baseRequest,
          query: 'token=secret',
          url: '/ws/pi?token=secret',
          queryParams: { token: 'secret' },
        }),
        { locals: {} },
      )
    )?.authorized !== false,
    true,
  );
});

void test('StaticTokenAuthorizer accepts configured query token', () => {
  const authorizer = new StaticTokenAuthorizer({
    token: 'secret',
    queryParam: 'token',
  });

  assert.deepEqual(
    authorizer.authorize({
      ...baseRequest,
      query: 'token=secret',
      url: '/ws/pi?token=secret',
      queryParams: { token: 'secret' },
    }),
    { authorized: true },
  );
});

void test('createStaticTokenAuthHook accepts first-message token', async () => {
  const authorize = createStaticTokenAuthHook({
    token: 'secret',
  });

  assert.equal(
    (
      await authorize(
        createMessageAuthInput(baseRequest, {
          type: 'pi_ws_auth',
          token: 'secret',
        }),
        { locals: {} },
      )
    )?.authorized !== false,
    true,
  );
});

void test('composeHooks shares async session context', async () => {
  const hook = composeHooks(
    async (_request, context) => {
      context.session = { userId: 'user-1' };
      context.locals['traceId'] = 'trace-1';
    },
    (_request, context) => {
      assert.deepEqual(context.session, { userId: 'user-1' });
      assert.equal(context.locals['traceId'], 'trace-1');
      return {
        authorized: false,
        status: '403 Forbidden',
      };
    },
  );

  const context: RequestHookContext = { locals: {} };
  const decision = await hook(baseRequest, context);

  assert.deepEqual(decision, {
    authorized: false,
    status: '403 Forbidden',
  });
});

void test('createStaticTokenAuthHook can return a typed session', async () => {
  const hook = createStaticTokenAuthHook({
    token: 'secret',
    createSession: async (request) => ({
      userId: request.headers['x-user-id'] ?? 'anonymous',
    }),
  });

  const context: RequestHookContext<{ userId: string }> = { locals: {} };
  const result = await hook(
    createRequestAuthInput({
      ...baseRequest,
      headers: {
        'authorization': 'Bearer secret',
        'x-user-id': 'user-1',
      },
    }),
    context,
  );

  assert.deepEqual(result, {
    authorized: true,
    session: { userId: 'user-1' },
  });
});

void test('protectWebSocketBehavior stores hook session data on the websocket', async () => {
  let upgradedUserData: Record<string, unknown> | undefined;

  const behavior = protectWebSocketBehavior<
    { connected: boolean },
    { userId: string }
  >({
    behavior: {},
    hooks: [
      async (request, context) => {
        context.session = {
          userId: request.headers['x-user-id'] ?? 'anonymous',
        };
        context.locals['requestId'] = request.headers['x-request-id'];
      },
    ],
    createUserData: () => ({ connected: true }),
  });

  void behavior.upgrade?.(
    createFakeResponse({
      onUpgrade(userData) {
        upgradedUserData = userData;
      },
    }),
    createFakeRequest({
      headers: {
        'sec-websocket-key': 'key',
        'sec-websocket-protocol': '',
        'sec-websocket-extensions': '',
        'x-request-id': 'req-1',
        'x-user-id': 'user-1',
      },
    }),
    {},
  );

  await flushAsyncWork();

  const ws = createFakeWebSocket(upgradedUserData ?? {});
  void behavior.open?.(ws);

  assert.deepEqual(
    getWebSocketSession<{ connected: boolean }, { userId: string }>(ws),
    { userId: 'user-1' },
  );
  assert.equal(
    getWebSocketContext<{ connected: boolean }, { userId: string }>(ws)
      ?.authenticated,
    true,
  );
  assert.equal(
    getWebSocketContext<{ connected: boolean }, { userId: string }>(ws)?.locals[
      'requestId'
    ],
    'req-1',
  );

  behavior.close?.(ws, 1000, new ArrayBuffer(0));
  assert.equal(
    getWebSocketContext<{ connected: boolean }, { userId: string }>(ws),
    undefined,
  );
});

function createFakeRequest({
  headers = {},
  method = 'get',
  path = '/ws/pi',
  query = '',
}: {
  headers?: Record<string, string>;
  method?: string;
  path?: string;
  query?: string;
}) {
  return {
    forEach(callback: (key: string, value: string) => void) {
      for (const [key, value] of Object.entries(headers)) {
        callback(key, value);
      }
    },
    getHeader(name: string) {
      return headers[name] ?? '';
    },
    getCaseSensitiveMethod() {
      return method.toUpperCase();
    },
    getMethod() {
      return method;
    },
    getParameter() {
      return undefined;
    },
    getQuery() {
      return query;
    },
    setYield() {
      return this;
    },
    getUrl() {
      return path;
    },
  } as const;
}

function createFakeResponse({
  onUpgrade,
}: {
  onUpgrade: (userData: Record<string, unknown>) => void;
}) {
  let abortedHandler: (() => void) | undefined;

  const response = {
    cork(callback: () => void) {
      callback();
      return response;
    },
    end() {
      return response;
    },
    endWithoutBody() {
      return response;
    },
    getRemoteAddressAsText() {
      return new TextEncoder().encode('127.0.0.1').buffer;
    },
    onAborted(handler: () => void) {
      abortedHandler = handler;
      return response;
    },
    upgrade(userData: Record<string, unknown>) {
      onUpgrade(userData);
    },
    writeHeader() {
      return response;
    },
    writeStatus() {
      return response;
    },
    get abortedHandler() {
      return abortedHandler;
    },
  };

  return response as never;
}

function createFakeWebSocket(userData: Record<string, unknown>) {
  return {
    getUserData() {
      return userData;
    },
  } as never;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
