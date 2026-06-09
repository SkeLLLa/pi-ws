import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  composeAuthorizers,
  createStaticTokenAuthorizer,
} from '../src/server/auth.js';
import type { AuthorizationRequest } from '../src/server/types.js';

const baseRequest: AuthorizationRequest = {
  method: 'GET',
  path: '/ws/pi',
  query: '',
  url: '/ws/pi',
  queryParams: {},
  headers: {},
};

void test('createStaticTokenAuthorizer accepts bearer token header', () => {
  const authorize = createStaticTokenAuthorizer({
    token: 'secret',
  });

  assert.equal(
    authorize({
      ...baseRequest,
      headers: { authorization: 'Bearer secret' },
    }).authorized,
    true,
  );
});

void test('createStaticTokenAuthorizer accepts configured query token', () => {
  const authorize = createStaticTokenAuthorizer({
    token: 'secret',
    queryParam: 'token',
  });

  assert.equal(
    authorize({
      ...baseRequest,
      query: 'token=secret',
      url: '/ws/pi?token=secret',
      queryParams: { token: 'secret' },
    }).authorized,
    true,
  );
});

void test('composeAuthorizers stops at first failure', () => {
  const authorize = composeAuthorizers(
    () => ({ authorized: true }),
    () => ({
      authorized: false,
      status: '403 Forbidden',
      body: JSON.stringify({ error: 'forbidden' }),
    }),
    () => {
      throw new Error('should not execute');
    },
  );

  assert.deepEqual(authorize(baseRequest), {
    authorized: false,
    status: '403 Forbidden',
    body: JSON.stringify({ error: 'forbidden' }),
  });
});
