import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentOpeners } from '../src/brain.js';

const turn = (role, content) => ({ role, content });

test('recentOpeners reads only what the persona said', () => {
  const openers = recentOpeners([
    turn('user', 'Sir you owe five thousand dollars'),
    turn('assistant', 'Oh my heavens, five thousand? Let me sit down.'),
    turn('user', 'Pay now'),
    turn('assistant', 'Well now, hold on, I need my glasses.'),
  ]);
  assert.deepEqual(openers, ['Oh my heavens', 'Well now, hold on']);
});

test('recentOpeners strips audio tags so the cue is not mistaken for words', () => {
  const openers = recentOpeners([turn('assistant', '[frightened] Oh my heavens, the police?')]);
  assert.deepEqual(openers, ['Oh my heavens, the']);
});

test('recentOpeners keeps only the most recent turns', () => {
  const history = Array.from({ length: 8 }, (_, i) => turn('assistant', `Phrase ${i} carries on and on`));
  const openers = recentOpeners(history, 3);
  assert.equal(openers.length, 3);
  assert.equal(openers[2], 'Phrase 7 carries on');
});

test('recentOpeners returns nothing before the persona has spoken', () => {
  assert.deepEqual(recentOpeners([turn('user', 'Hello?')]), []);
  assert.deepEqual(recentOpeners([]), []);
});

test('recentOpeners ignores empty assistant turns', () => {
  assert.deepEqual(recentOpeners([turn('assistant', '   '), turn('assistant', 'Hold on now please')]), [
    'Hold on now please',
  ]);
});
