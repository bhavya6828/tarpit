import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportsWebsocket, fillerCacheKey } from '../src/elevenlabs.js';

test('supportsWebsocket rejects models the streaming endpoint refuses', () => {
  assert.equal(supportsWebsocket('eleven_v3'), false);
  assert.equal(supportsWebsocket('eleven_v3_preview'), false);
});

test('supportsWebsocket accepts the streaming models', () => {
  assert.equal(supportsWebsocket('eleven_turbo_v2_5'), true);
  assert.equal(supportsWebsocket('eleven_flash_v2_5'), true);
  assert.equal(supportsWebsocket('eleven_multilingual_v2'), true);
});

test('supportsWebsocket defaults to streaming for an unknown model', () => {
  assert.equal(supportsWebsocket(''), true);
  assert.equal(supportsWebsocket(undefined), true);
});

test('fillerCacheKey separates voice, model, format and phrase', () => {
  const a = fillerCacheKey('voiceA', 'eleven_v3', 'pcm_24000', 'Hold on now.');
  const b = fillerCacheKey('voiceB', 'eleven_v3', 'pcm_24000', 'Hold on now.');
  const c = fillerCacheKey('voiceA', 'eleven_turbo_v2_5', 'pcm_24000', 'Hold on now.');
  const d = fillerCacheKey('voiceA', 'eleven_v3', 'ulaw_8000', 'Hold on now.');
  const e = fillerCacheKey('voiceA', 'eleven_v3', 'pcm_24000', 'Oh my.');
  assert.equal(new Set([a, b, c, d, e]).size, 5, 'keys must not collide');
});

test('fillerCacheKey is stable and filesystem safe', () => {
  const k = fillerCacheKey('voiceA', 'eleven_v3', 'pcm_24000', '[confused] Oh my... heavens!');
  assert.equal(k, fillerCacheKey('voiceA', 'eleven_v3', 'pcm_24000', '[confused] Oh my... heavens!'));
  assert.match(k, /^[A-Za-z0-9_.-]+$/);
});
