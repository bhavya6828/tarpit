import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioEngine } from '../web/lib/audio.ts';
import { bridgeOfflineMessage, emptySessionView, normalizeInjectedText } from '../web/lib/sessionView.ts';

test('Next uses a patched PostCSS release', () => {
  const lock = JSON.parse(readFileSync(new URL('../web/package-lock.json', import.meta.url)));
  const version = lock.packages['node_modules/next/node_modules/postcss']?.version
    || lock.packages['node_modules/postcss']?.version;
  const [major, minor, patch] = version.split('.').map(Number);

  assert.ok(major > 8 || major === 8 && (minor > 5 || minor === 5 && patch >= 23));
});

test('type-to-talk accepts trimmed live input only', () => {
  assert.equal(normalizeInjectedText('  call me now  ', true), 'call me now');
  assert.equal(normalizeInjectedText('   ', true), null);
  assert.equal(normalizeInjectedText('call me', false), null);
});

test('new session view clears every prior live value', () => {
  assert.deepEqual(emptySessionView(), {
    transcript: [],
    partial: '',
    agentLive: '',
    intel: [],
    metrics: null,
    enrichment: null,
    signals: [],
    agentSpeaking: false,
  });
});

test('offline state gives the operator a useful action', () => {
  assert.match(bridgeOfflineMessage, /server running/i);
});

test('audio flush stops queued sources and resets playback state', () => {
  const engine = new AudioEngine({
    onPcm() {},
    onInputLevel() {},
    onOutputLevel() {},
    onPlaybackDone() {},
  });
  let stopped = 0;
  const source = {
    onended() {},
    stop() {
      stopped++;
    },
  };
  engine.playbackCtx = { currentTime: 12 };
  engine.sources.add(source);
  engine.queuedForTurn = 1;
  engine.playingTurn = 7;
  engine.nextStart = 99;

  engine.flush();

  assert.equal(stopped, 1);
  assert.equal(source.onended, null);
  assert.equal(engine.sources.size, 0);
  assert.equal(engine.queuedForTurn, 0);
  assert.equal(engine.playingTurn, -1);
  assert.equal(engine.nextStart, 12);
});
