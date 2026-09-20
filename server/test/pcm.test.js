import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesPerSample, alignSamples } from '../src/elevenlabs.js';

test('bytesPerSample reflects the codec width', () => {
  assert.equal(bytesPerSample('pcm_24000'), 2);
  assert.equal(bytesPerSample('pcm_16000'), 2);
  assert.equal(bytesPerSample('ulaw_8000'), 1);
});

test('alignSamples holds back a split sample', () => {
  const r = alignSamples(Buffer.from([1, 2, 3]), Buffer.alloc(0), 2);
  assert.deepEqual([...r.emit], [1, 2]);
  assert.deepEqual([...r.carry], [3]);
});

test('alignSamples rejoins a sample split across chunks', () => {
  const first = alignSamples(Buffer.from([1, 2, 3]), Buffer.alloc(0), 2);
  const second = alignSamples(Buffer.from([4, 5, 6]), first.carry, 2);
  assert.deepEqual([...second.emit], [3, 4, 5, 6]);
  assert.equal(second.carry.length, 0);
});

test('alignSamples never emits an odd byte count for 16-bit audio', () => {
  let carry = Buffer.alloc(0);
  for (const size of [1, 3, 5, 7, 11, 1, 2]) {
    const r = alignSamples(Buffer.alloc(size, 7), carry, 2);
    assert.equal(r.emit.length % 2, 0, `emitted ${r.emit.length} bytes`);
    carry = r.carry;
    assert.ok(carry.length < 2, 'carry must never hold a whole sample');
  }
});

test('alignSamples is a passthrough for single-byte codecs', () => {
  const r = alignSamples(Buffer.from([1, 2, 3]), Buffer.alloc(0), 1);
  assert.deepEqual([...r.emit], [1, 2, 3]);
  assert.equal(r.carry.length, 0);
});

test('alignSamples loses no bytes across a stream', () => {
  const chunks = [Buffer.from([1]), Buffer.from([2, 3, 4]), Buffer.from([5, 6])];
  let carry = Buffer.alloc(0);
  const out = [];
  for (const c of chunks) {
    const r = alignSamples(c, carry, 2);
    out.push(r.emit);
    carry = r.carry;
  }
  assert.deepEqual([...Buffer.concat(out)], [1, 2, 3, 4, 5, 6]);
  assert.equal(carry.length, 0);
});
