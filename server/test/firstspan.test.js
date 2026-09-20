import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeOpeningSpan } from '../src/elevenlabs.js';

test('takeOpeningSpan releases a clause once it is long enough to speak', () => {
  const r = takeOpeningSpan('Oh my heavens, five thousand dollars? Hold on', 24);
  assert.equal(r.span, 'Oh my heavens, five thousand dollars?');
  assert.equal(r.rest, ' Hold on');
});

test('takeOpeningSpan waits rather than emitting a stub', () => {
  // "Oh my," on its own would be clipped and is what made the voice sound like
  // dictation in the first place.
  const r = takeOpeningSpan('Oh my, well', 24);
  assert.equal(r.span, null);
  assert.equal(r.rest, 'Oh my, well');
});

test('takeOpeningSpan breaks on a comma when no sentence has ended yet', () => {
  const r = takeOpeningSpan('Well now son, I am going to need a moment here', 24);
  assert.equal(r.span, 'Well now son, I am going to need a moment here'.slice(0, r.span.length));
  assert.ok(r.span.endsWith(','), `expected a clause break, got "${r.span}"`);
});

test('takeOpeningSpan prefers a sentence end over a later comma', () => {
  const r = takeOpeningSpan('Five thousand dollars is a lot. Hold on now, son', 24);
  assert.equal(r.span, 'Five thousand dollars is a lot.');
});

test('takeOpeningSpan keeps an audio tag attached', () => {
  const r = takeOpeningSpan('[frightened] Oh my heavens, that is a lot of money', 24);
  assert.ok(r.span.startsWith('[frightened]'), `tag detached: "${r.span}"`);
});

test('takeOpeningSpan is lossless', () => {
  const input = 'Oh my heavens, five thousand dollars? Hold on';
  const r = takeOpeningSpan(input, 24);
  assert.equal(r.span + r.rest, input);
});
