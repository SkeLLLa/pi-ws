import { Buffer } from 'node:buffer';
import type {
  HttpRequest,
  HttpResponse,
  us_socket_context_t,
  WebSocket,
  WebSocketBehavior,
} from 'uWebSockets.js';
import type {
  AuthHook,
  AuthHookInput,
  AuthorizationFailure,
  AuthorizationRequest,
  AuthorizationResult,
  HttpHandler,
  MaybePromise,
  RequestAuthorizer,
  RequestHook,
  RequestHookContext,
  RequestHookResult,
  RequestHookSuccess,
  WebSocketConnectionContext,
} from './types.js';

const AUTHORIZED = { authorized: true } as const;
const DEFAULT_UNAUTHORIZED_BODY = JSON.stringify({ error: 'unauthorized' });
const SOCKET_CONTEXT = Symbol('piWs.socketContext');
const WEBSOCKET_CONTEXTS = new WeakMap<
  WebSocket<unknown>,
  WebSocketConnectionContext
>();

/**
 * Static token auth settings for `StaticTokenAuthorizer`.
 *
 * @public
 */
export interface StaticTokenAuthorizerOptions {
  /**
   * Shared secret token that clients must present.
   */
  readonly token: string;
  /**
   * Header name to check.
   *
   * @defaultValue `"authorization"`
   */
  readonly header?: string;
  /**
   * Optional query-string parameter name to check.
   *
   * @remarks
   * This is useful for browser WebSocket clients that cannot set arbitrary
   * request headers.
   */
  readonly queryParam?: string;
  /**
   * Optional HTTP auth scheme prefix used when matching the header value.
   *
   * @defaultValue `"Bearer"`
   */
  readonly scheme?: string;
  /**
   * Optional realm included in `WWW-Authenticate` on header-based failures.
   */
  readonly realm?: string;
}

/**
 * Static token auth settings for `createStaticTokenAuthHook()`.
 *
 * @typeParam Session - Optional session type attached by the hook.
 * @public
 */
export interface StaticTokenAuthHookOptions<
  Session = unknown,
> extends StaticTokenAuthorizerOptions {
  /**
   * Optional session factory invoked after the token check passes.
   */
  readonly createSession?: (
    request: AuthorizationRequest,
  ) => MaybePromise<Session>;
}

/**
 * Simple shared-secret token authorizer.
 *
 * @remarks
 * Validates either a header such as `Authorization: Bearer <token>`,
 * a query-string parameter such as `?token=<token>`, or both.
 *
 * @public
 */
export class StaticTokenAuthorizer {
  readonly #token: string;
  readonly #headerName: string;
  readonly #queryParam: string | undefined;
  readonly #scheme: string;
  readonly #realm: string | undefined;

  constructor(options: StaticTokenAuthorizerOptions) {
    if (options.token.trim() === '') {
      throw new Error('Static token authorizer token must not be empty');
    }
    this.#token = options.token;
    this.#headerName = (options.header ?? 'authorization').toLowerCase();
    this.#queryParam = options.queryParam;
    this.#scheme = options.scheme ?? 'Bearer';
    this.#realm = options.realm;
  }

  authorize: RequestAuthorizer = (request) => {
    const headerValue = request.headers[this.#headerName];
    if (
      headerValue !== undefined &&
      matchesHeaderToken(headerValue, this.#token, this.#scheme)
    ) {
      return AUTHORIZED;
    }

    if (
      this.#queryParam !== undefined &&
      request.queryParams[this.#queryParam] === this.#token
    ) {
      return AUTHORIZED;
    }

    return headerValue !== undefined || this.#queryParam === undefined
      ? unauthorized({
          headers: buildAuthenticateHeaders(this.#scheme, this.#realm),
        })
      : unauthorized();
  };
}

/**
 * Creates a reusable static-token request hook.
 *
 * @remarks
 * This is both a ready-made auth hook and a compact example of how custom
 * hooks can deny requests and attach session data.
 *
 * @typeParam Session - Optional session type attached by the hook.
 * @param options - Static token match settings and optional session factory.
 * @returns Async-capable request hook.
 * @public
 */
export function createStaticTokenAuthHook<Session = unknown>(
  options: StaticTokenAuthHookOptions<Session>,
): AuthHook<Session> {
  if (options.token.trim() === '') {
    throw new Error('Static token auth hook token must not be empty');
  }

  const scheme = options.scheme ?? 'Bearer';

  return async (auth) => {
    const token = getStaticTokenAuthInputToken(auth, options);
    if (token === undefined) {
      return undefined;
    }

    if (!matchesHeaderToken(token, options.token, scheme)) {
      return unauthorized({
        ...(auth.source === 'request'
          ? { headers: buildAuthenticateHeaders(scheme, options.realm) }
          : {}),
      });
    }

    if (options.createSession === undefined) {
      return AUTHORIZED;
    }

    return {
      authorized: true,
      session: await options.createSession(auth.request),
    } satisfies RequestHookSuccess<Session>;
  };
}

/**
 * Wraps an HTTP handler with synchronous request authorization.
 *
 * @returns Protected handler.
 * @public
 */
export function protectHttpHandler({
  handler,
  authorize,
}: {
  handler: HttpHandler;
  authorize: RequestAuthorizer;
}): HttpHandler {
  return (res, req) => {
    const decision = authorize(createAuthorizationRequest(req, res));
    if (!decision.authorized) {
      rejectRequest(res, decision);
      return;
    }

    handler(res, req);
  };
}

/**
 * Wraps a WebSocket behavior with request authorization hooks.
 *
 * @remarks
 * This follows the async upgrade pattern from the `uWebSockets.js`
 * `UpgradeAsync.js` example: it snapshots request data immediately, registers
 * `res.onAborted()`, runs hooks asynchronously, then upgrades inside
 * `res.cork()` with the copied headers.
 *
 * @typeParam UserData - `uWebSockets.js` per-socket user data type.
 * @typeParam Session - Optional session type attached by hooks.
 * @returns Protected behavior.
 * @public
 */
export function protectWebSocketBehavior<UserData, Session = unknown>({
  behavior,
  hooks = [],
  authHooks = [],
  createUserData,
}: {
  behavior: Omit<WebSocketBehavior<UserData>, 'upgrade'>;
  hooks?: readonly RequestHook<Session>[];
  authHooks?: readonly AuthHook<Session>[];
  createUserData?: (
    request: AuthorizationRequest,
    context: WebSocketConnectionContext<Session>,
  ) => UserData;
}): WebSocketBehavior<UserData> {
  if (hooks.length === 0 && authHooks.length === 0) {
    return behavior;
  }

  return {
    ...behavior,
    open(ws) {
      adoptWebSocketContext<UserData>(ws);
      void behavior.open?.(ws);
    },
    upgrade(res, req, context) {
      const request = createAuthorizationRequest(req, res);
      const upgradeState = {
        aborted: false,
        headers: {
          key: req.getHeader('sec-websocket-key'),
          protocol: req.getHeader('sec-websocket-protocol'),
          extensions: req.getHeader('sec-websocket-extensions'),
        },
      };

      res.onAborted(() => {
        upgradeState.aborted = true;
      });

      void upgradeWebSocket({
        authHooks,
        createUserData,
        headers: upgradeState.headers,
        hooks,
        request,
        res,
        socketContext: context,
      }).catch((error: unknown) => {
        if (upgradeState.aborted) return;

        rejectRequest(
          res,
          unauthorized({
            status: '500 Internal Server Error',
            body: JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : 'websocket upgrade hook failed',
            }),
          }),
        );
      });
    },
    close(ws, code, message) {
      WEBSOCKET_CONTEXTS.delete(ws);
      behavior.close?.(ws, code, message);
    },
  };
}

/**
 * Combines multiple authorizers using logical AND semantics.
 *
 * @param authorizers - Authorizers to run in order.
 * @returns Combined authorizer.
 * @public
 */
export function composeAuthorizers(
  ...authorizers: readonly RequestAuthorizer[]
): RequestAuthorizer {
  return (request) => {
    for (const authorize of authorizers) {
      const decision = authorize(request);
      if (!decision.authorized) {
        return decision;
      }
    }

    return AUTHORIZED;
  };
}

/**
 * Combines multiple async-capable hooks using logical AND semantics.
 *
 * @param hooks - Hooks to run in order.
 * @returns Combined request hook.
 * @public
 */
export function composeHooks<Session = unknown>(
  ...hooks: readonly RequestHook<Session>[]
): RequestHook<Session> {
  return async (request, context) => {
    return runRequestHooks({ request, context, hooks });
  };
}

/**
 * Returns the stored upgrade context for a protected WebSocket connection.
 *
 * @typeParam UserData - Route user-data type.
 * @typeParam Session - Optional session type attached by hooks.
 * @param ws - Protected WebSocket instance.
 * @returns Stored connection context, if any.
 * @public
 */
export function getWebSocketContext<UserData, Session = unknown>(
  ws: WebSocket<UserData>,
): WebSocketConnectionContext<Session> | undefined {
  return WEBSOCKET_CONTEXTS.get(ws) as
    | WebSocketConnectionContext<Session>
    | undefined;
}

/**
 * Returns the stored session for a protected WebSocket connection.
 *
 * @typeParam Session - Optional session type attached by hooks.
 * @param ws - Protected WebSocket instance.
 * @returns Stored session, if any.
 * @public
 */
export function getWebSocketSession<UserData, Session = unknown>(
  ws: WebSocket<UserData>,
): WebSocketConnectionContext<Session>['session'] {
  return getWebSocketContext<UserData, Session>(ws)?.session;
}

/**
 * Stores or replaces the context associated with a WebSocket connection.
 *
 * @typeParam UserData - Route user-data type.
 * @typeParam Session - Optional session type attached by hooks.
 * @param ws - WebSocket instance.
 * @param context - Connection context to store.
 * @public
 */
export function setWebSocketContext<UserData, Session = unknown>(
  ws: WebSocket<UserData>,
  context: WebSocketConnectionContext<Session>,
): void {
  WEBSOCKET_CONTEXTS.set(ws, context);
}

/**
 * Extracts auth credentials from a WebSocket upgrade request.
 *
 * @param request - Structured request data.
 * @param options - Header/query field names and auth scheme.
 * @returns Auth hook input for request-sourced credentials.
 * @public
 */
export function createRequestAuthInput(
  request: AuthorizationRequest,
  options: {
    readonly header?: string;
    readonly queryParam?: string;
    readonly scheme?: string;
  } = {},
): AuthHookInput {
  const headerName = (options.header ?? 'authorization').toLowerCase();
  const queryParam = options.queryParam ?? 'token';
  const headerValue = request.headers[headerName];
  const queryValue = request.queryParams[queryParam];
  const token =
    extractHeaderToken(headerValue, options.scheme ?? 'Bearer') ?? queryValue;

  return {
    source: 'request',
    request,
    provided: token !== undefined,
    ...(token === undefined ? {} : { token }),
  };
}

/**
 * Extracts auth credentials from a parsed first-message auth envelope.
 *
 * @param request - Structured upgrade request data.
 * @param message - Parsed auth envelope.
 * @returns Auth hook input for message-sourced credentials.
 * @public
 */
export function createMessageAuthInput(
  request: AuthorizationRequest,
  message: Readonly<Record<string, unknown>>,
): AuthHookInput {
  const token =
    typeof message['token'] === 'string' ? message['token'] : undefined;
  const payload = message['payload'];

  return {
    source: 'message',
    request,
    provided: token !== undefined || payload !== undefined,
    message,
    ...(token === undefined ? {} : { token }),
    ...(payload === undefined ? {} : { payload }),
  };
}

function createAuthorizationRequest(
  req: HttpRequest,
  res?: HttpResponse,
): AuthorizationRequest {
  const headers: Record<string, string> = {};
  req.forEach((key, value) => {
    headers[key] = value;
  });

  const path = req.getUrl();
  const query = req.getQuery();

  return {
    method: req.getMethod().toUpperCase(),
    path,
    query,
    url: query === '' ? path : `${path}?${query}`,
    queryParams: parseQueryParams(query),
    headers,
    ...(res === undefined
      ? {}
      : { remoteAddress: bufferToString(res.getRemoteAddressAsText()) }),
  };
}

function parseQueryParams(query: string): Readonly<Record<string, string>> {
  if (query === '') return {};

  const parsed: Record<string, string> = {};
  const entries = new URLSearchParams(query);
  for (const [key, value] of entries) {
    if (!(key in parsed)) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function bufferToString(value: ArrayBuffer): string {
  return Buffer.from(value).toString('utf8');
}

function matchesHeaderToken(
  headerValue: string,
  token: string,
  scheme: string,
): boolean {
  const normalized = headerValue.trim();
  if (normalized === token) return true;
  return normalized === `${scheme} ${token}`;
}

function extractHeaderToken(
  headerValue: string | undefined,
  scheme: string,
): string | undefined {
  if (headerValue === undefined) return undefined;

  const normalized = headerValue.trim();
  if (scheme === '') return normalized;

  const prefix = `${scheme} `;
  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
}

function getStaticTokenAuthInputToken(
  auth: AuthHookInput,
  options: StaticTokenAuthorizerOptions,
): string | undefined {
  if (auth.token !== undefined) {
    return auth.token;
  }

  const headerValue =
    auth.request.headers[(options.header ?? 'authorization').toLowerCase()];
  const headerToken = extractHeaderToken(
    headerValue,
    options.scheme ?? 'Bearer',
  );
  if (headerToken !== undefined) {
    return headerToken;
  }

  if (options.queryParam === undefined) {
    return undefined;
  }

  return auth.request.queryParams[options.queryParam];
}

function buildAuthenticateHeaders(
  scheme: string,
  realm: string | undefined,
): Readonly<Record<string, string>> {
  if (scheme === '') return {};

  const value = realm === undefined ? scheme : `${scheme} realm="${realm}"`;
  return { 'www-authenticate': value };
}

function unauthorized(
  failure: Omit<AuthorizationFailure, 'authorized'> = {},
): AuthorizationFailure {
  return {
    authorized: false,
    status: failure.status ?? '401 Unauthorized',
    ...(failure.headers === undefined ? {} : { headers: failure.headers }),
    body: failure.body ?? DEFAULT_UNAUTHORIZED_BODY,
  };
}

function rejectRequest(
  res: HttpResponse,
  decision: AuthorizationFailure,
): void {
  res.cork(() => {
    res.writeStatus(decision.status ?? '401 Unauthorized');

    for (const [key, value] of Object.entries(decision.headers ?? {})) {
      res.writeHeader(key, value);
    }

    if (decision.body === undefined) {
      res.endWithoutBody();
      return;
    }

    if (
      decision.headers === undefined ||
      !Object.keys(decision.headers).some(
        (key) => key.toLowerCase() === 'content-type',
      )
    ) {
      res.writeHeader('content-type', 'application/json');
    }

    res.end(decision.body);
  });
}

async function upgradeWebSocket<Session = unknown>({
  authHooks,
  createUserData,
  headers,
  hooks,
  request,
  res,
  socketContext,
}: {
  authHooks: readonly AuthHook<Session>[];
  createUserData:
    | ((
        request: AuthorizationRequest,
        context: WebSocketConnectionContext<Session>,
      ) => unknown)
    | undefined;
  headers: {
    key: string;
    protocol: string;
    extensions: string;
  };
  hooks: readonly RequestHook<Session>[];
  request: AuthorizationRequest;
  res: HttpResponse;
  socketContext: us_socket_context_t;
}): Promise<void> {
  const hookContext = createRequestHookContext<Session>();
  const decision = await runRequestHooks<Session>({
    request,
    context: hookContext,
    hooks,
  });
  if (!decision.authorized) {
    rejectRequest(res, decision);
    return;
  }

  const requestAuth = await runAuthHooks<Session>({
    auth: createRequestAuthInput(request),
    context: hookContext,
    hooks: authHooks,
  });
  if (!requestAuth.decision.authorized) {
    rejectRequest(res, requestAuth.decision);
    return;
  }

  const connectionContext = finalizeWebSocketContext<Session>({
    authProvided: requestAuth.provided,
    authenticated: authHooks.length === 0 || requestAuth.authenticated,
    request,
    hookContext,
  });
  const userData = stageWebSocketContext(
    createUserData?.(request, connectionContext) ?? {},
    connectionContext,
  );

  res.cork(() => {
    res.upgrade(
      userData,
      headers.key,
      headers.protocol,
      headers.extensions,
      socketContext,
    );
  });
}

function createRequestHookContext<
  Session = unknown,
>(): RequestHookContext<Session> {
  return { locals: {} };
}

async function runRequestHooks<Session = unknown>({
  request,
  context,
  hooks,
}: {
  request: AuthorizationRequest;
  context: RequestHookContext<Session>;
  hooks: readonly RequestHook<Session>[];
}): Promise<AuthorizationResult> {
  if (hooks.length === 0) {
    return AUTHORIZED;
  }

  for (const hook of hooks) {
    const result = await hook(request, context);
    if (result?.authorized === false) {
      return result;
    }

    if (result?.session !== undefined) {
      context.session = result.session;
    }
  }

  return AUTHORIZED;
}

export async function runAuthHooks<Session = unknown>({
  auth,
  context,
  hooks,
}: {
  auth: AuthHookInput;
  context: RequestHookContext<Session>;
  hooks: readonly AuthHook<Session>[];
}): Promise<{
  readonly authenticated: boolean;
  readonly provided: boolean;
  readonly decision: AuthorizationResult;
}> {
  if (hooks.length === 0) {
    return {
      authenticated: true,
      provided: auth.provided,
      decision: AUTHORIZED,
    };
  }

  let authenticated = false;

  for (const hook of hooks) {
    const result = await hook(auth, context);
    const normalized = applyHookResult({ context, result });
    if (!normalized.authorized) {
      return {
        authenticated: false,
        provided: auth.provided,
        decision: normalized,
      };
    }

    authenticated ||= result !== undefined;
  }

  return {
    authenticated,
    provided: auth.provided,
    decision: AUTHORIZED,
  };
}

function applyHookResult<Session>({
  context,
  result,
}: {
  context: RequestHookContext<Session>;
  result: RequestHookResult<Session>;
}): AuthorizationResult {
  if (result?.authorized === false) {
    return result;
  }

  if (result?.session !== undefined) {
    context.session = result.session;
  }

  return AUTHORIZED;
}

function finalizeWebSocketContext<Session = unknown>({
  authProvided,
  authenticated,
  request,
  hookContext,
}: {
  authProvided: boolean;
  authenticated: boolean;
  request: AuthorizationRequest;
  hookContext: RequestHookContext<Session>;
}): WebSocketConnectionContext<Session> {
  return {
    request,
    locals: Object.freeze({ ...hookContext.locals }),
    authProvided,
    authenticated,
    ...(hookContext.session === undefined
      ? {}
      : { session: hookContext.session }),
  };
}

function stageWebSocketContext<UserData, Session = unknown>(
  userData: UserData,
  context: WebSocketConnectionContext<Session>,
): UserData {
  (
    userData as UserData & {
      [SOCKET_CONTEXT]: WebSocketConnectionContext<Session> | undefined;
    }
  )[SOCKET_CONTEXT] = context;
  return userData;
}

function adoptWebSocketContext<UserData>(ws: WebSocket<UserData>): void {
  const data = ws.getUserData() as UserData & {
    [SOCKET_CONTEXT]: WebSocketConnectionContext | undefined;
  };
  const context = data[SOCKET_CONTEXT];
  if (context === undefined) return;

  WEBSOCKET_CONTEXTS.set(ws, context);
  data[SOCKET_CONTEXT] = undefined;
}

export type {
  AuthHook,
  AuthHookInput,
  AuthorizationResult,
  RequestAuthorizer,
  RequestHook,
  RequestHookContext,
  RequestHookResult,
  RequestHookSuccess,
  WebSocketConnectionContext,
} from './types.js';
