import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telephonyPrior, scoreUtterance, screeningVerdict } from '../src/screening.js';

test('an unvouched caller ID is the strongest pre-speech signal', () => {
  const spoofed = telephonyPrior({ attestation: 'failed', lineType: 'voip' });
  const vouched = telephonyPrior({ attestation: 'A', lineType: 'mobile' });
  assert.ok(spoofed.score > vouched.score, 'spoofed must outrank vouched');
  assert.match(spoofed.reasons.join(' '), /caller ID/i);
});

test('a prior is never on its own a verdict', () => {
  const prior = telephonyPrior({ attestation: 'failed', lineType: 'voip' });
  assert.equal(screeningVerdict({ score: prior.score, utterances: 0 }), 'screening');
});

test('the browser demo has no telephony signal and starts neutral', () => {
  const prior = telephonyPrior(null);
  assert.equal(prior.score, 0);
  assert.deepEqual(prior.reasons, []);
});

test('authority plus payment demand plus coercion scores as fraud', () => {
  const s = scoreUtterance(
    'This is the IRS. You owe five thousand dollars and will be arrested unless you send Apple gift cards today.'
  );
  assert.ok(s.score >= 60, `expected a decisive score, got ${s.score}`);
  assert.equal(screeningVerdict({ score: s.score, utterances: 1 }), 'scam');
});

test('remote access tooling alone is decisive', () => {
  const s = scoreUtterance('I need you to install AnyDesk so I can fix your computer.');
  assert.equal(screeningVerdict({ score: s.score, utterances: 1 }), 'scam');
});

test('an ordinary call is released once enough has been said', () => {
  const s = scoreUtterance('Hi, this is the dentist confirming your appointment on Thursday at ten.');
  assert.ok(s.score < 25, `ordinary call scored ${s.score}`);
  assert.equal(screeningVerdict({ score: s.score, utterances: 2 }), 'legitimate');
});

test('an ordinary call is not released before it has said enough', () => {
  assert.equal(screeningVerdict({ score: 0, utterances: 1 }), 'screening');
});

test('an ambiguous call keeps screening rather than guessing', () => {
  assert.equal(screeningVerdict({ score: 40, utterances: 3 }), 'screening');
});
