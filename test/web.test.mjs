import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioEngine } from '../web/lib/audio.ts';
import { bridgeOfflineMessage, emptySessionView, normalizeInjectedText } from '../web/lib/sessionView.ts';

const readWebFile = (path) => readFileSync(new URL(`../web/${path}`, import.meta.url), 'utf8');

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

test('command center keeps every work area reachable on narrow screens', () => {
  const source = readWebFile('components/CommandCenter.tsx');

  assert.match(source, /aria-label="Workspace views"/);
  assert.match(source, />Conversation</);
  assert.match(source, />Evidence</);
  assert.match(source, />Session</);
  assert.doesNotMatch(source, /hidden min-h-0 lg:block/);
});

test('command center uses the dark console visual system', () => {
  const css = readWebFile('app/globals.css');

  // A defence console read from across a room, not a document.
  assert.match(css, /--color-canvas:\s*#08090b/i);
  assert.match(css, /--color-surface:\s*#101216/i);
  assert.match(css, /--color-text:\s*#e8eaed/i);
  assert.match(css, /--color-accent:\s*#00e08a/i);

  // The hero metric has to be legible at distance, so it is clamped large.
  assert.match(css, /\.hero-metric/);
  assert.match(css, /clamp\(44px/);

  // Captured evidence announces itself, then settles.
  assert.match(css, /\.evidence-land/);

  // Depth comes from gradients and glow, never from scanlines or CRT pastiche.
  assert.doesNotMatch(css, /repeating-linear-gradient|scanline/i);
});

test('referral package is exposed as an accessible dialog', () => {
  const source = readWebFile('components/CaseFile.tsx');

  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="case-file-title"/);
});

test('frontend integrates reconnect and safe frame helpers', () => {
  const source = readWebFile('lib/useTarpit.ts');

  assert.match(source, /reconnectDelay/);
  assert.match(source, /parseSocketMessage/);
  assert.match(source, /appendUniqueError/);
  assert.doesNotMatch(source, /JSON\.parse\(ev\.data/);
});

test('frontend HTTP effects abort stale requests', () => {
  const hook = readWebFile('lib/useTarpit.ts');
  const intel = readWebFile('components/IntelPanel.tsx');
  const report = readWebFile('components/CaseFile.tsx');

  assert.match(hook, /AbortController/);
  assert.match(intel, /AbortController/);
  assert.match(report, /AbortController/);
});
