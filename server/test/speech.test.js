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
  // The bug this guards: ~12-char flushes mid-phrase, which made the voice
  // read word by word. Length is the wrong invariant, since "Hold on now." is
  // a legitimate short clause. What matters is that every span except the last
  // ends on a clause boundary rather than in the middle of a phrase.
  const out = chunkForSpeech(
    'Oh my heavens, five thousand dollars? Hold on now, son, let me sit down. Can you repeat that?',
    'clause'
  );
  assert.ok(out.length > 1, 'expected several clauses');
  for (const c of out) {
    assert.match(c.trim(), /[.!?,;:]$/, `span does not end on a clause boundary: "${c}"`);
  }
});
