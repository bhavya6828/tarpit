import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { attachMediaStream, validateSignature } from '../src/twilio.js';

const originalToken = config.twilio.authToken;

afterEach(() => {
  config.twilio.authToken = originalToken;
});

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('condition not reached');
};

function signedRequest(url, body, token) {
  const data = Object.keys(body)
    .sort()
    .reduce((value, key) => value + key + body[key], url);
  const signature = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  return {
    body,
    get(name) {
      return name === 'X-Twilio-Signature' ? signature : undefined;
    },
  };
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.sent = [];
    this.closed = false;
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit('close');
  }
}

class FakeSession extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.started = false;
    this.stops = [];
    this.audio = [];
    this.playback = [];
  }

  async start() {
    this.started = true;
  }

  async stop(reason) {
    this.stops.push(reason);
  }

  pushAudio(buffer) {
    this.audio.push(buffer);
  }

  notePlaybackDone(turnId) {
    this.playback.push(turnId);
  }
}

test('Twilio signature accepts valid input and rejects bad or missing credentials', () => {
  const url = 'https://demo.example/twilio/voice';
  const body = { CallSid: 'CA123', From: '+12125551212' };
  config.twilio.authToken = 'test-token';
  const request = signedRequest(url, body, config.twilio.authToken);

  assert.equal(validateSignature(request, url), true);
  assert.equal(validateSignature({ ...request, get: () => 'bad-signature' }, url), false);
  config.twilio.authToken = '';
  assert.equal(validateSignature(request, url), false);
});

test('unknown Twilio CallSid is rejected without creating a session', async () => {
  const ws = new FakeSocket();
  let created = 0;
  attachMediaStream(ws, {
    pendingCalls: new Map(),
    makeSession() {
      created++;
      return new FakeSession({});
    },
  });

  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ event: 'start', start: { streamSid: 'MZ1', callSid: 'CA-unknown' } }))
  );
  await waitFor(() => ws.closed || created > 0);

  assert.equal(created, 0);
  assert.equal(ws.closed, true);
});

test('known Twilio stream handles inbound and outbound frames then stops', async () => {
  const ws = new FakeSocket();
  const profile = { callSid: 'CA-known', from: '+12125551212', transport: 'twilio' };
  const pendingCalls = new Map([[profile.callSid, profile]]);
  let session;
  attachMediaStream(ws, {
    pendingCalls,
    makeSession(options) {
      session = new FakeSession(options);
      return session;
    },
  });

  ws.emit(
    'message',
    Buffer.from(
      JSON.stringify({
        event: 'start',
        start: { streamSid: 'MZ-known', callSid: profile.callSid, customParameters: { persona: 'dale' } },
      })
    )
  );
  await waitFor(() => session?.started);
  assert.equal(session.options.caller, profile);
  assert.equal(session.options.personaId, 'dale');
  assert.equal(pendingCalls.has(profile.callSid), false);

  const inbound = Buffer.from([1, 2, 3, 4]);
  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: inbound.toString('base64') } }))
  );
  await waitFor(() => session.audio.length === 1);
  assert.deepEqual(session.audio[0], inbound);

  session.emit('audio', { pcm: Buffer.alloc(320, 7) });
  session.emit('event', { type: 'audio_flush' });
  session.emit('event', { type: 'audio_end', turnId: 9 });
  const sentTypes = ws.sent.map((item) => item.event);
  assert.deepEqual(sentTypes, ['media', 'media', 'clear', 'mark']);

  ws.emit('message', Buffer.from(JSON.stringify({ event: 'mark', mark: { name: 'turn-9' } })));
  await waitFor(() => session.playback.length === 1);
  assert.deepEqual(session.playback, [9]);

  ws.emit('message', Buffer.from(JSON.stringify({ event: 'stop' })));
  await waitFor(() => ws.closed);
  assert.deepEqual(session.stops, ['caller_hung_up']);
});

test('socket close tears down an active Twilio session once', async () => {
  const ws = new FakeSocket();
  const pendingCalls = new Map([['CA-close', { callSid: 'CA-close', transport: 'twilio' }]]);
  let session;
  attachMediaStream(ws, {
    pendingCalls,
    makeSession(options) {
      session = new FakeSession(options);
      return session;
    },
  });

  ws.emit(
    'message',
    Buffer.from(JSON.stringify({ event: 'start', start: { streamSid: 'MZ-close', callSid: 'CA-close' } }))
  );
  await waitFor(() => session?.started);
  ws.close();
  await waitFor(() => session.stops.length === 1);

  assert.deepEqual(session.stops, ['stream_closed']);
});
