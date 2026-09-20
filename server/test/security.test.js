import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionGate, requestAuthorized } from '../src/security.js';

const request = ({ address = '127.0.0.1', token, authorization, url = '/ws' } = {}) => ({
  url,
  socket: { remoteAddress: address },
  headers: {
    ...(token ? { 'x-honeypot-token': token } : {}),
    ...(authorization ? { authorization } : {}),
  },
});

test('local-only mode accepts loopback and rejects remote clients', () => {
  assert.equal(requestAuthorized(request(), ''), true);
  assert.equal(requestAuthorized(request({ address: '::1' }), ''), true);
  assert.equal(requestAuthorized(request({ address: '::ffff:127.0.0.1' }), ''), true);
  assert.equal(requestAuthorized(request({ address: '203.0.113.10' }), ''), false);
});

test('token mode requires a matching header, bearer token, or websocket query', () => {
  const secret = 'demo-access-token';

  assert.equal(requestAuthorized(request({ address: '203.0.113.10', token: secret }), secret), true);
  assert.equal(
    requestAuthorized(request({ address: '203.0.113.10', authorization: `Bearer ${secret}` }), secret),
    true
  );
  assert.equal(
    requestAuthorized(request({ address: '203.0.113.10', url: `/ws?token=${secret}` }), secret),
    true
  );
  assert.equal(requestAuthorized(request({ token: 'wrong' }), secret), false);
  assert.equal(requestAuthorized(request(), secret), false);
});

test('session gate caps active sessions and releases capacity', () => {
  const gate = new SessionGate(2);
  const first = {};
  const second = {};
  const third = {};

  assert.equal(gate.tryAdd(first), true);
  assert.equal(gate.tryAdd(second), true);
  assert.equal(gate.tryAdd(third), false);
  assert.equal(gate.size, 2);
  gate.delete(first);
  assert.equal(gate.tryAdd(third), true);
  assert.equal(gate.size, 2);
});
