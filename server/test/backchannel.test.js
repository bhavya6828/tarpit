import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backchannelDue } from '../src/brain.js';

const base = { speakingSince: 1000, lastAt: 0, count: 0, agentSpeaking: false, turnInFlight: false };

test('holds back until the caller has really been talking', () => {
  assert.equal(backchannelDue({ ...base }, 2000), false, 'one second in');
  assert.equal(backchannelDue({ ...base }, 3600), true, 'past the threshold');
});

test('spaces reactions apart', () => {
  assert.equal(backchannelDue({ ...base, lastAt: 3000 }, 5000), false, 'two seconds after the last');
  assert.equal(backchannelDue({ ...base, lastAt: 3000 }, 7500), true, 'four seconds after');
});

test('stops after two in one caller turn', () => {
  assert.equal(backchannelDue({ ...base, count: 1 }, 4000), true);
  assert.equal(backchannelDue({ ...base, count: 2 }, 4000), false, 'a third reads as interrupting');
});

test('never speaks over the persona', () => {
  assert.equal(backchannelDue({ ...base, agentSpeaking: true }, 4000), false);
  assert.equal(backchannelDue({ ...base, turnInFlight: true }, 4000), false);
});

test('does nothing before the caller has started', () => {
  assert.equal(backchannelDue({ ...base, speakingSince: 0 }, 4000), false);
});
