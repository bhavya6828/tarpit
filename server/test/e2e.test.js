import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/elastic.js';
import { buildCaseFile, toFtcComplaint, toMarkdown, toStixBundle } from '../src/report.js';
import { Session } from '../src/session.js';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('condition not reached');
};

test('typed browser demo completes through intel, audio, storage, and reports', async () => {
  const baseDir = path.join(process.cwd(), 'data');
  await mkdir(baseDir, { recursive: true });
  const dataDir = await mkdtemp(path.join(baseDir, 'test-e2e-'));
  tempDirs.push(dataDir);

  const store = new Store({ dataDir, elastic: {} });
  await store.init();
  const deepgram = { send() {}, close() {} };
  const tts = [];
  const dependencies = {
    store,
    openaiAvailable: false,
    pick: (items) => items[0],
    createDeepgram: () => deepgram,
    createTTS(options) {
      const voice = {
        cancelled: false,
        connect() {},
        push(text) {
          if (text.trim()) options.onAudio(Buffer.alloc(320, 7));
        },
        end() {
          options.onDone();
        },
        cancel() {
          this.cancelled = true;
        },
      };
      tts.push(voice);
      return voice;
    },
    async *streamReply() {
      yield 'Oh my, I need a moment. Can you repeat that number?';
    },
    async enrich() {
      return null;
    },
  };
  const session = new Session({ personaId: 'harold', dependencies });
  const events = [];
  const audio = [];
  session.on('event', (event) => events.push(event));
  session.on('audio', (frame) => audio.push(frame));

  await session.start();
  session.notePlaybackDone(session.turnId);
  session.injectScammerText(
    'I am Agent Stone with the IRS. Call 212-555-1212. Send payment to routing number zero two one zero zero zero zero two one immediately or police will arrest you.'
  );
  await waitFor(() => session.turnCount === 1 && !session.turnInFlight);
  await session.stop('qa_complete');

  assert.ok(events.some((event) => event.type === 'session_start'));
  assert.ok(events.some((event) => event.type === 'session_end'));
  assert.ok(events.some((event) => event.type === 'transcript' && event.speaker === 'scammer'));
  assert.ok(events.some((event) => event.type === 'transcript' && event.speaker === 'persona'));
  assert.ok(audio.length > 0);
  assert.ok(session.intel.some((item) => item.type === 'bank_routing'));
  assert.ok(session.intel.some((item) => item.type === 'callback_number'));
  assert.ok(session.intel.some((item) => item.type === 'impersonation'));
  assert.ok(session.intel.some((item) => item.type === 'coercion'));

  const file = await buildCaseFile(session.id, store);
  assert.equal(file.engagement.status, 'ended');
  assert.ok(file.artifacts.items.some((item) => item.type === 'bank_routing' && item.value === '*****0021'));
  assert.equal(JSON.parse(JSON.stringify(toStixBundle(file))).type, 'bundle');
  assert.equal(toFtcComplaint(file).portal, 'https://reportfraud.ftc.gov/');
  assert.match(toMarkdown(file), new RegExp(file.case_id));

  const disk = (
    await Promise.all(
      ['sessions.jsonl', 'intel.jsonl', 'utterances.jsonl'].map((name) => readFile(path.join(dataDir, name), 'utf8'))
    )
  ).join('\n');
  assert.doesNotMatch(disk, /021000021/);
  assert.match(disk, /\*+0021/);

  const restarted = new Store({ dataDir, elastic: {} });
  await restarted.init();
  const recovered = await buildCaseFile(session.id, restarted);
  assert.equal(recovered.case_id, file.case_id);
  assert.equal(recovered.transcript.length, file.transcript.length);
  assert.equal(tts.some((voice) => voice.cancelled), true);
});
