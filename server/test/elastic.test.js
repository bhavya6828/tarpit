import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/elastic.js';

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempStore(options = {}) {
  const baseDir = path.join(process.cwd(), 'data');
  await mkdir(baseDir, { recursive: true });
  const dataDir = await mkdtemp(path.join(baseDir, 'test-store-'));
  tempDirs.push(dataDir);
  return { dataDir, store: new Store({ dataDir, elastic: {}, ...options }) };
}

test('local fallback writes redacted JSONL and reloads it after restart', async () => {
  const { dataDir, store } = await tempStore();
  await store.init();
  await store.upsertSession({ session_id: 'persist-1', status: 'ended', seconds_wasted: 42 });
  await store.indexIntel([
    {
      id: 'routing-1',
      session_id: 'persist-1',
      type: 'bank_routing',
      value: '021000021',
      source_utterance: 'Routing 021000021 and card 4111 1111 1111 1111',
      meta: { validated: 'ABA mod-10 checksum PASS' },
    },
    {
      id: 'account-1',
      session_id: 'persist-1',
      type: 'bank_account',
      value: '123456789012',
      source_utterance: 'Account 123456789012',
      meta: { digits: 12 },
    },
  ]);
  await store.indexUtterance({
    session_id: 'persist-1',
    speaker: 'scammer',
    text: 'Routing 021000021, account 123456789012, card 4111 1111 1111 1111',
  });

  const disk = (
    await Promise.all(
      ['sessions.jsonl', 'intel.jsonl', 'utterances.jsonl'].map((name) => readFile(path.join(dataDir, name), 'utf8'))
    )
  ).join('\n');
  assert.doesNotMatch(disk, /021000021|123456789012|4111 1111 1111 1111/);
  assert.match(disk, /\*+0021/);
  assert.match(disk, /\*+9012/);
  assert.match(disk, /\*+1111/);

  const restarted = new Store({ dataDir, elastic: {} });
  await restarted.init();
  const bundle = await restarted.sessionBundle('persist-1');

  assert.equal(bundle.session.status, 'ended');
  assert.equal(bundle.intel.length, 2);
  assert.equal(bundle.utterances.length, 1);
  assert.equal(bundle.intel[0].value, '*****0021');
});

test('provider failure still serves report data recovered from JSONL', async () => {
  const { dataDir, store } = await tempStore();
  await store.init();
  await store.upsertSession({ session_id: 'fallback-1', status: 'ended' });
  await store.indexIntel([
    {
      id: 'phone-1',
      session_id: 'fallback-1',
      type: 'callback_number',
      value: '(212) 555-1212',
      source_utterance: 'Call back',
      meta: {},
    },
  ]);

  const failed = new Store({
    dataDir,
    elastic: { node: 'https://elastic.invalid' },
    createClient: () => ({
      async ping() {
        throw new Error('provider unavailable');
      },
    }),
  });
  await failed.init();
  const bundle = await failed.sessionBundle('fallback-1');

  assert.equal(failed.mode, 'memory');
  assert.match(failed.error, /provider unavailable/);
  assert.equal(bundle.session.status, 'ended');
  assert.equal(bundle.intel[0].value, '(212) 555-1212');
});
