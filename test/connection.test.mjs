import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendUniqueError,
  parseSocketMessage,
  reconnectDelay,
  resolveServerUrls,
} from '../web/lib/connection.ts';

test('server URLs follow explicit and page security', () => {
  assert.deepEqual(resolveServerUrls('localhost:8787', 'http:'), {
    http: 'http://localhost:8787',
    ws: 'ws://localhost:8787/ws',
  });
  assert.deepEqual(resolveServerUrls('api.tarpit.test', 'https:'), {
    http: 'https://api.tarpit.test',
    ws: 'wss://api.tarpit.test/ws',
  });
  assert.deepEqual(resolveServerUrls('https://secure.tarpit.test', 'http:'), {
    http: 'https://secure.tarpit.test',
    ws: 'wss://secure.tarpit.test/ws',
  });
});

test('reconnect delay grows and stays bounded', () => {
  assert.equal(reconnectDelay(0), 500);
  assert.equal(reconnectDelay(1), 1000);
  assert.equal(reconnectDelay(4), 8000);
  assert.equal(reconnectDelay(20), 8000);
});

test('socket parser accepts events and rejects malformed JSON', () => {
  assert.deepEqual(parseSocketMessage('{"type":"hello","personas":[]}'), {
    kind: 'event',
    event: { type: 'hello', personas: [] },
  });
  assert.deepEqual(parseSocketMessage('{bad json'), { kind: 'invalid' });
  assert.deepEqual(parseSocketMessage('{"personas":[]}'), { kind: 'invalid' });
});

test('socket parser validates binary audio frame length', () => {
  assert.deepEqual(parseSocketMessage(new ArrayBuffer(3)), { kind: 'invalid' });

  const frame = new ArrayBuffer(8);
  const view = new DataView(frame);
  view.setUint32(0, 27, true);
  new Uint8Array(frame, 4).set([1, 2, 3, 4]);
  const parsed = parseSocketMessage(frame);

  assert.equal(parsed.kind, 'audio');
  assert.equal(parsed.turnId, 27);
  assert.deepEqual([...new Uint8Array(parsed.payload)], [1, 2, 3, 4]);
});

test('repeated bridge errors are retained once', () => {
  const first = appendUniqueError([], 'bridge unavailable');
  const repeated = appendUniqueError(first, 'bridge unavailable');
  const next = appendUniqueError(repeated, 'bad frame');

  assert.deepEqual(repeated, ['bridge unavailable']);
  assert.deepEqual(next, ['bridge unavailable', 'bad frame']);
});
