import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consecutiveStalls } from '../src/brain.js';

const persona = { obstacles: { glasses: /glasses/i, cat: /biscuits/i, wallet: /wallet/i } };
const a = (content) => ({ role: 'assistant', content });
const u = (content) => ({ role: 'user', content });

test('counts only the stalls at the end of the conversation', () => {
  assert.equal(consecutiveStalls(persona, [a('Where are my glasses'), a('Five thousand? Goodness.')]), 0);
  assert.equal(consecutiveStalls(persona, [a('Five thousand?'), a('Where are my glasses')]), 1);
  assert.equal(consecutiveStalls(persona, [a('My wallet is gone'), a('Mr. Biscuits again')]), 2);
});

test('the caller talking does not break or create a run', () => {
  assert.equal(consecutiveStalls(persona, [a('My wallet'), u('Hurry up'), a('And my glasses')]), 2);
});

test('an ordinary reply resets the run', () => {
  assert.equal(consecutiveStalls(persona, [a('My wallet'), a('Yes, I understand, go on')]), 0);
});

test('no history means no stalls', () => {
  assert.equal(consecutiveStalls(persona, []), 0);
  assert.equal(consecutiveStalls({ obstacles: {} }, [a('anything')]), 0);
});
