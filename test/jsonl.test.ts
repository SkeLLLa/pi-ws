import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JsonlSplitter, parseJsonObject } from '../src/utils/jsonl.js';

void test('JsonlSplitter splits only on LF', () => {
  const splitter = new JsonlSplitter();
  const lines = splitter.push(
    Buffer.from('{"message":"a b"}\n{"message":"c"}\r\npartial'),
  );

  assert.deepEqual(lines, ['{"message":"a b"}', '{"message":"c"}']);
  assert.deepEqual(splitter.push(Buffer.from('\n')), ['partial']);
});

void test('JsonlSplitter preserves UTF-8 characters split across chunks', () => {
  const splitter = new JsonlSplitter();
  const euro = Buffer.from('€', 'utf8');
  const prefix = Buffer.from('{"message":"', 'utf8');
  const suffix = Buffer.from('"}\n', 'utf8');

  assert.deepEqual(
    splitter.push(Buffer.concat([prefix, euro.subarray(0, 1)])),
    [],
  );
  assert.deepEqual(splitter.push(Buffer.concat([euro.subarray(1), suffix])), [
    '{"message":"€"}',
  ]);
});

void test('JsonlSplitter flushes a final partial line', () => {
  const splitter = new JsonlSplitter();

  assert.deepEqual(splitter.push(Buffer.from('{"message":"partial"}')), []);
  assert.deepEqual(splitter.flush(), ['{"message":"partial"}']);
  assert.deepEqual(splitter.flush(), []);
});

void test('JsonlSplitter rejects over-sized lines', () => {
  const splitter = new JsonlSplitter({ maxLineBytes: 4 });

  assert.throws(
    () => splitter.push(Buffer.from('12345')),
    /JSONL line exceeds max size/u,
  );
});

void test('parseJsonObject rejects non-object JSON', () => {
  assert.deepEqual(parseJsonObject('{"type":"get_state"}'), {
    type: 'get_state',
  });
  assert.throws(() => parseJsonObject('[]'), /Expected a JSON object/u);
});
