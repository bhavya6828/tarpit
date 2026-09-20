import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAudioTags, chunkForSpeech } from '../src/brain.js';

test('stripAudioTags removes emotional direction from transcript text', () => {
  assert.equal(
    stripAudioTags('[confused] Oh my heavens. [sighs] Hold on now.'),
    'Oh my heavens. Hold on now.'
  );
  assert.equal(stripAudioTags('No tags here.'), 'No tags here.');
  assert.equal(stripAudioTags('[shaky breathless] Five thousand?'), 'Five thousand?');
});

test('stripAudioTags leaves bracketed text that is not a direction', () => {
  // Only leading-position, lowercase, short directions are treated as tags.
  assert.equal(stripAudioTags('Account [12345] is frozen.'), 'Account [12345] is frozen.');
});

test('chunkForSpeech at reply granularity yields exactly one span', () => {
  const text = 'Oh my heavens, five thousand? Hold on now, son. Can you repeat that?';
  const out = chunkForSpeech(text, 'reply');
  assert.equal(out.length, 1);
  assert.equal(out[0], text);
});

test('chunkForSpeech at clause granularity splits on clause ends', () => {
  const out = chunkForSpeech('Oh my heavens, five thousand dollars? Hold on now, let me sit down.', 'clause');
  assert.ok(out.length >= 2, `expected multiple clauses, got ${out.length}`);
  assert.equal(out.join(''), 'Oh my heavens, five thousand dollars? Hold on now, let me sit down.');
});

test('chunkForSpeech never splits abbreviations or decimals', () => {
  const out = chunkForSpeech('Mr. Biscuits owes 5.000 dollars to the I.R.S. today.', 'clause');
  assert.ok(!out.some((c) => c.trim().endsWith('Mr.')), 'split on "Mr."');
  assert.ok(!out.some((c) => c.trim().endsWith('5.')), 'split on decimal');
});

test('chunkForSpeech never emits a word fragment', () => {
  // The bug this exists to prevent: ~12-char flushes mid-phrase.
  const out = chunkForSpeech('Oh my heavens, five thousand dollars? Hold on now.', 'clause');
  for (const c of out) {
    assert.ok(c.trim().length > 12, `fragment emitted: "${c}"`);
  }
});
