import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { DeepgramStream } from '../src/deepgram.js';
import { ElevenLabsStream } from '../src/elevenlabs.js';

const originalDeepgramConnect = DeepgramStream.prototype.connect;
const originalElevenLabsConnect = ElevenLabsStream.prototype.connect;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

before(() => {
  DeepgramStream.prototype.connect = function connect() {
    return this;
  };
  ElevenLabsStream.prototype.connect = function connect() {
    return this;
  };
  globalThis.setTimeout = (fn, delay, ...args) => {
    if (delay >= 1000) return { pending: fn };
    return originalSetTimeout(fn, delay, ...args);
  };
  globalThis.clearTimeout = (handle) => {
    if (handle?.pending) return;
    originalClearTimeout(handle);
  };
});

after(() => {
  DeepgramStream.prototype.connect = originalDeepgramConnect;
  ElevenLabsStream.prototype.connect = originalElevenLabsConnect;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => originalSetTimeout(resolve, 5));
  }
  assert.fail('condition not reached');
};

function makeHarness({ streamReply, enrich, openaiAvailable = false } = {}) {
  const calls = {
    sessions: [],
    utterances: [],
    intel: [],
    tts: [],
    enrich: 0,
  };
  let deepgram = null;
  const store = {
    async upsertSession(doc) {
      calls.sessions.push(doc);
    },
    async indexUtterance(doc) {
      calls.utterances.push(doc);
    },
    async indexIntel(items) {
      calls.intel.push(...items);
    },
  };
  const dependencies = {
    store,
    openaiAvailable,
    createDeepgram(options) {
      deepgram = {
        options,
        sent: [],
        closed: false,
        send(chunk) {
          this.sent.push(chunk);
        },
        close() {
          this.closed = true;
        },
      };
      return deepgram;
    },
    createTTS(options) {
      const tts = {
        options,
        chunks: [],
        cancelled: false,
        connect() {},
        push(chunk) {
          this.chunks.push(chunk);
        },
        end() {},
        cancel() {
          this.cancelled = true;
        },
      };
      calls.tts.push(tts);
      return tts;
    },
    streamReply:
      streamReply ||
      (async function* reply() {
        yield 'Can you repeat that?';
      }),
    async enrich(...args) {
      calls.enrich++;
      return enrich ? enrich(...args) : null;
    },
  };
  const session = new Session({ dependencies });
  return { session, calls, get deepgram() { return deepgram; } };
}

test('session start and stop use injected transports and store', async () => {
  const harness = makeHarness();
  const events = [];
  harness.session.on('event', (event) => events.push(event));

  try {
    await harness.session.start();
    assert.equal(harness.session.status, 'live');
    assert.ok(harness.deepgram);
    assert.equal(harness.calls.sessions.at(-1).status, 'live');

    await harness.session.stop('test_complete');
    assert.equal(harness.session.status, 'ended');
    assert.equal(harness.deepgram.closed, true);
    assert.equal(harness.calls.sessions.at(-1).status, 'ended');
    assert.ok(events.some((event) => event.type === 'session_start'));
    assert.ok(events.some((event) => event.type === 'session_end'));
  } finally {
    await harness.session.stop();
  }
});

test('final transcript is persisted and harvested', async () => {
  const harness = makeHarness();

  try {
    await harness.session.start();
    assert.ok(harness.deepgram);
    harness.deepgram.options.onTranscript({
      text: 'Call me at 212-555-1212 right now',
      isFinal: true,
      speechFinal: false,
      confidence: 0.98,
    });
    await waitFor(() => harness.calls.utterances.some((item) => item.speaker === 'scammer'));

    assert.equal(harness.calls.utterances.at(-1).text, 'Call me at 212-555-1212 right now');
    assert.ok(harness.calls.intel.some((item) => item.type === 'callback_number'));
  } finally {
    await harness.session.stop();
  }
});

test('caller text queued during a reply runs as the next turn', async () => {
  let release;
  let replyCount = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const harness = makeHarness({
    streamReply: async function* reply() {
      replyCount++;
      if (replyCount === 1) await gate;
      yield 'Please say that again.';
    },
  });

  try {
    await harness.session.start();
    harness.session.notePlaybackDone(harness.session.turnId);
    harness.session.injectScammerText('First request');
    harness.session.injectScammerText('Second request');
    release();
    await waitFor(() => harness.session.turnCount === 2 && !harness.session.turnInFlight);

    assert.deepEqual(
      harness.session.history.filter((item) => item.role === 'user').map((item) => item.content),
      ['First request', 'Second request']
    );
  } finally {
    await harness.session.stop();
  }
});

test('barge-in cancels stale response work and flushes audio', async () => {
  const harness = makeHarness();
  const events = [];
  harness.session.on('event', (event) => events.push(event));

  try {
    await harness.session.start();
    const opener = harness.calls.tts[0];
    harness.session.injectScammerText('Please stop talking');
    await waitFor(() => events.some((event) => event.type === 'interrupted'));

    assert.equal(opener.cancelled, true);
    assert.ok(events.some((event) => event.type === 'audio_flush'));
    assert.equal(harness.session.interruptions, 1);
  } finally {
    await harness.session.stop();
  }
});

test('enrichment failure does not prevent session teardown', async () => {
  const harness = makeHarness({
    openaiAvailable: true,
    enrich: async () => {
      throw new Error('provider unavailable');
    },
  });

  await harness.session.start();
  harness.session.notePlaybackDone(harness.session.turnId);
  harness.session.injectScammerText('This is an urgent payment request');
  await waitFor(() => !harness.session.turnInFlight);

  await assert.doesNotReject(() => harness.session.stop('provider_failure'));
  assert.equal(harness.calls.enrich, 1);
  assert.equal(harness.session.status, 'ended');
});

test('missing provider key fallback still completes a typed turn', async () => {
  const harness = makeHarness({ openaiAvailable: false });
  const events = [];
  harness.session.on('event', (event) => events.push(event));

  try {
    await harness.session.start();
    harness.session.notePlaybackDone(harness.session.turnId);
    harness.session.injectScammerText('Hello there');
    await waitFor(() => !harness.session.turnInFlight);

    assert.equal(harness.session.turnCount, 1);
    assert.ok(harness.calls.utterances.some((item) => item.speaker === 'persona'));
    assert.equal(events.some((event) => event.type === 'error'), false);
  } finally {
    await harness.session.stop();
  }
});
