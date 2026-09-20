import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abaValid,
  extractIntel,
  luhnValid,
  normalizeSpokenDigits,
} from '../src/intel.js';

test('normalizeSpokenDigits assembles dictated numbers without eating delimiters', () => {
  assert.equal(
    normalizeSpokenDigits('routing is zero two one zero zero zero zero two one or call me'),
    'routing is 021000021 or call me'
  );
  assert.equal(normalizeSpokenDigits('code five oh five double four triple seven'), 'code 50544777');
});

test('luhnValid accepts valid cards and rejects malformed values', () => {
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(luhnValid('378282246310005'), true);
  assert.equal(luhnValid('4111111111111112'), false);
  assert.equal(luhnValid('1234'), false);
});

test('abaValid enforces checksum and Federal Reserve prefixes', () => {
  assert.equal(abaValid('021000021'), true);
  assert.equal(abaValid('021000022'), false);
  assert.equal(abaValid('000000000'), false);
  assert.equal(abaValid('131000012'), false);
});

test('payment card span masks nested callback and account candidates', () => {
  const found = extractIntel('My account card is 4111 1111 1111 1111.', { sessionId: 'span' });

  assert.deepEqual(found.map((item) => item.type), ['payment_card']);
  assert.equal(found[0].meta.last4, '1111');
  assert.equal(found[0].meta.validated, 'Luhn mod-10 PASS');
});

test('seen set deduplicates formatting variants and repeated utterances', () => {
  const seen = new Set();
  const first = extractIntel('Call 212-555-1212 or 2125551212.', { sessionId: 'dedupe', seen });
  const second = extractIntel('Again, call (212) 555-1212.', { sessionId: 'dedupe', seen });

  assert.equal(first.filter((item) => item.type === 'callback_number').length, 1);
  assert.equal(second.filter((item) => item.type === 'callback_number').length, 0);
});

test('invalid long digit strings do not leak nested phone numbers', () => {
  const found = extractIntel('Reference 4000002125551212 is invalid.', { sessionId: 'false-positive' });

  assert.equal(found.some((item) => item.type === 'callback_number'), false);
});
