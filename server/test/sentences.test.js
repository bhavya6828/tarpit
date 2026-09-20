import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeSentences } from '../src/elevenlabs.js';

test('takeSentences yields only completed sentences', () => {
  const r = takeSentences('Oh my heavens. Hold on now');
  assert.deepEqual(r.sentences, ['Oh my heavens.']);
  assert.equal(r.rest, ' Hold on now');
});

test('takeSentences holds a sentence until its terminator arrives', () => {
  const r = takeSentences('Hold on now, son');
  assert.deepEqual(r.sentences, []);
  assert.equal(r.rest, 'Hold on now, son');
});

test('takeSentences takes several at once', () => {
  // Separating whitespace stays attached to the sentence that follows it, which
  // is what keeps the split lossless. It is harmless in synthesis.
  const r = takeSentences('Oh my. Hold on! Are you there? Let me');
  assert.deepEqual(r.sentences, ['Oh my.', ' Hold on!', ' Are you there?']);
  assert.equal(r.rest, ' Let me');
});

test('takeSentences does not split abbreviations or decimals', () => {
  const r = takeSentences('Mr. Biscuits owes 5.000 dollars to the I.R.S. today. Next');
  assert.deepEqual(r.sentences, ['Mr. Biscuits owes 5.000 dollars to the I.R.S. today.']);
  assert.equal(r.rest, ' Next');
});

test('takeSentences keeps a leading audio tag with its sentence', () => {
  const r = takeSentences('[frightened] Oh my heavens. Hold');
  assert.deepEqual(r.sentences, ['[frightened] Oh my heavens.']);
});

test('takeSentences is lossless', () => {
  const input = 'One thing. Two things! Three? Trailing text';
  const r = takeSentences(input);
  assert.equal(r.sentences.join('') + r.rest, input);
});
