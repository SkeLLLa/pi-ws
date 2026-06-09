import { Buffer } from 'node:buffer';
import type {
  HttpRequest,
  HttpResponse,
  WebSocketBehavior,
} from 'uWebSockets.js';
import type {
  AuthorizationFailure,
  AuthorizationRequest,
  HttpHandler,
  RequestAuthorizer,
} from './types.js';

const AUTHORIZED = { authorized: true } as const;
const DEFAULT_UNAUTHORIZED_BODY = JSON.stringify({ error: 'unauthorized' });

/**
 * Static token auth settings for `createStaticTokenAuthorizer()`.
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
 * Wraps an HTTP handler with synchronous request authorization.
 *
 * @param handler - Original route handler.
 * @param authorize - Authorizer to run before the handler.
 * @returns Protected handler.
 * @public
 */
export function protectHttpHandler(
  handler: HttpHandler,
  authorize: RequestAuthorizer,
): HttpHandler {
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
 * Wraps a WebSocket behavior with synchronous request authorization.
 *
 * @remarks
 * If the wrapped behavior does not define its own `upgrade` handler,
 * `pi-ws` upgrades the socket automatically after successful authorization
 * using either the provided `createUserData()` callback or an empty object.
 *
 * @typeParam UserData - `uWebSockets.js` per-socket user data type.
 * @param behavior - Original WebSocket behavior.
 * @param authorize - Authorizer to run before upgrade.
 * @param createUserData - Optional user-data factory for auto-upgrade.
 * @returns Protected behavior.
 * @public
 */
export function protectWebSocketBehavior<UserData>(
  behavior: WebSocketBehavior<UserData>,
  authorize: RequestAuthorizer,
  createUserData?: (request: AuthorizationRequest) => UserData,
): WebSocketBehavior<UserData> {
  return {
    ...behavior,
    upgrade(res, req, context) {
      const request = createAuthorizationRequest(req, res);
      const decision = authorize(request);
      if (!decision.authorized) {
        rejectRequest(res, decision);
        return;
      }

      if (behavior.upgrade !== undefined) {
        void behavior.upgrade(res, req, context);
        return;
      }

      res.upgrade(
        createUserData?.(request) ?? ({} as UserData),
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context,
      );
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
 * Creates a simple shared-secret token authorizer.
 *
 * @remarks
 * This helper can validate either a header such as
 * `Authorization: Bearer <token>`, a query-string parameter such as
 * `?token=<token>`, or both.
 *
 * @param options - Token and matching settings.
 * @returns Reusable request authorizer.
 * @public
 */
export function createStaticTokenAuthorizer(
  options: StaticTokenAuthorizerOptions,
): RequestAuthorizer {
  const headerName = (options.header ?? 'authorization').toLowerCase();
  const queryParam = options.queryParam;
  const scheme = options.scheme ?? 'Bearer';

  if (options.token.trim() === '') {
    throw new Error('Static token authorizer token must not be empty');
  }

  return (request) => {
    const headerValue = request.headers[headerName];
    if (
      headerValue !== undefined &&
      matchesHeaderToken(headerValue, options.token, scheme)
    ) {
      return AUTHORIZED;
    }

    if (
      queryParam !== undefined &&
      request.queryParams[queryParam] === options.token
    ) {
      return AUTHORIZED;
    }

    return headerValue !== undefined || queryParam === undefined
      ? unauthorized({
          headers: buildAuthenticateHeaders(scheme, options.realm),
        })
      : unauthorized();
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

export type { AuthorizationResult, RequestAuthorizer } from './types.js';
