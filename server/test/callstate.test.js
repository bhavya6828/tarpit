import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCallState, spentObstacles } from '../src/brain.js';

const persona = { obstacles: { glasses: /glasses|reading specs/i, cat: /biscuits|the cat/i, wallet: /wallet|purse/i } };

test('spentObstacles finds only what the persona actually used', () => {
  const history = [
    { role: 'user', content: 'Where is your wallet' },
    { role: 'assistant', content: 'Hold on, Mr. Biscuits is sitting on my paperwork.' },
  ];
  assert.deepEqual(spentObstacles(persona, history), ['cat']);
});

test('spentObstacles ignores the caller and reports each excuse once', () => {
  const history = [
    { role: 'assistant', content: 'I cannot find my glasses.' },
    { role: 'user', content: 'Check your glasses again' },
    { role: 'assistant', content: 'Still looking for those reading specs.' },
  ];
  assert.deepEqual(spentObstacles(persona, history), ['glasses']);
});

test('describeCallState reports what the caller has revealed', () => {
  const state = describeCallState({
    persona,
    history: [],
    intel: [
      { type: 'bank_routing', label: 'ABA routing number', value: '021000021' },
      { type: 'impersonation', label: 'Claimed authority', value: 'IRS' },
    ],
    enrichment: { claimed_org: 'IRS', claimed_name: 'Agent Miller', amount_demanded: '$5,000', payment_rail: 'wire' },
    elapsedSeconds: 120,
    turnCount: 6,
  });
  assert.match(state, /Agent Miller/);
  assert.match(state, /IRS/);
  assert.match(state, /021000021/);
  assert.match(state, /\$5,000/);
});

test('describeCallState says an artifact is already captured', () => {
  const state = describeCallState({
    persona,
    history: [],
    intel: [{ type: 'bank_routing', label: 'ABA routing number', value: '021000021' }],
    enrichment: null,
    elapsedSeconds: 30,
    turnCount: 2,
  });
  assert.match(state, /already/i, 'must tell the persona it has this and need not ask again');
});

test('describeCallState lists spent excuses so they are not reused', () => {
  const state = describeCallState({
    persona,
    history: [{ role: 'assistant', content: 'My glasses have gone missing again.' }],
    intel: [],
    enrichment: null,
    elapsedSeconds: 20,
    turnCount: 1,
  });
  assert.match(state, /glasses/);
});

test('describeCallState returns nothing at the very start of a call', () => {
  const state = describeCallState({
    persona,
    history: [],
    intel: [],
    enrichment: null,
    elapsedSeconds: 0,
    turnCount: 0,
  });
  assert.equal(state, null);
});
