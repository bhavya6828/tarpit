import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/elastic.js';
import { buildCaseFile, toFtcComplaint, toMarkdown, toStixBundle } from '../src/report.js';

const sessionId = 'report-1';
const timestamp = '2026-09-20T12:00:00.000Z';

beforeEach(() => {
  store.connected = false;
  store.mode = 'memory';
  store.mem = {
    sessions: new Map([
      [
        sessionId,
        {
          session_id: sessionId,
          '@timestamp': timestamp,
          persona: 'harold',
          transport: 'browser',
          status: 'ended',
          seconds_wasted: 84,
          turns: 4,
          scam_type: 'irs_tax',
          claimed_org: 'IRS',
          payment_rail: 'bank transfer',
        },
      ],
    ]),
    intel: [
      {
        id: 'card-1',
        session_id: sessionId,
        type: 'payment_card',
        label: 'Payment card',
        value: '411111••••••1111',
        severity: 'critical',
        meta: { bin: '411111', last4: '1111', validated: 'Luhn mod-10 PASS' },
        source_utterance: 'Use card 4111 1111 1111 1111 now.',
        '@timestamp': timestamp,
      },
      {
        id: 'routing-1',
        session_id: sessionId,
        type: 'bank_routing',
        label: 'ABA routing number',
        value: '021000021',
        severity: 'critical',
        meta: { validated: 'ABA mod-10 checksum PASS', fed_prefix: '02' },
        source_utterance: 'The routing number is 021000021.',
        '@timestamp': timestamp,
      },
      {
        id: 'account-1',
        session_id: sessionId,
        type: 'bank_account',
        label: 'Bank account',
        value: '123456789012',
        severity: 'high',
        meta: { digits: 12 },
        source_utterance: 'Deposit to account 123456789012.',
        '@timestamp': timestamp,
      },
      {
        id: 'phone-1',
        session_id: sessionId,
        type: 'callback_number',
        label: 'Callback number',
        value: '(212) 555-1212',
        severity: 'high',
        meta: { e164: '+12125551212' },
        source_utterance: 'Call 212-555-1212.',
        '@timestamp': timestamp,
      },
      {
        id: 'phone-2',
        session_id: 'report-2',
        type: 'callback_number',
        label: 'Callback number',
        value: '(212) 555-1212',
        severity: 'high',
        meta: { e164: '+12125551212' },
        source_utterance: 'Call 212-555-1212.',
        '@timestamp': timestamp,
      },
    ],
    utterances: [
      {
        session_id: sessionId,
        speaker: 'scammer',
        text: 'Use card 4111 1111 1111 1111, routing 021000021, account 123456789012.',
        '@timestamp': timestamp,
      },
      {
        session_id: sessionId,
        speaker: 'persona',
        text: 'Can you repeat that?',
        '@timestamp': timestamp,
      },
    ],
  };
});

test('buildCaseFile returns a complete correlated case file', async () => {
  const file = await buildCaseFile(sessionId);

  assert.equal(file.case_id, 'HONEYPOT-REPORT-1');
  assert.equal(file.engagement.persona_deployed, 'Harold Pemberton (harold)');
  assert.equal(file.artifacts.total, 4);
  assert.equal(file.artifacts.validated, 2);
  assert.deepEqual(file.correlation.repeats[0].also_seen_in, ['report-2']);
  assert.equal(file.transcript[0].speaker, 'SUSPECT');
});

test('STIX bundle and FTC pre-fill contain valid report data', async () => {
  const file = await buildCaseFile(sessionId);
  const stix = toStixBundle(file);
  const ftc = toFtcComplaint(file);

  assert.equal(JSON.parse(JSON.stringify(stix)).type, 'bundle');
  assert.match(stix.id, /^bundle--[0-9a-f-]{36}$/);
  assert.ok(stix.objects.some((item) => item.type === 'report'));
  assert.ok(stix.objects.some((item) => item.type === 'indicator'));
  assert.equal(ftc.portal, 'https://reportfraud.ftc.gov/');
  assert.equal(ftc.fields.business_name, 'IRS');
  assert.ok(ftc.fields.payment_methods_requested.includes('Payment card'));
});

test('all report formats mask card and bank numbers', async () => {
  const file = await buildCaseFile(sessionId);
  const rendered = [
    JSON.stringify(file),
    JSON.stringify(toStixBundle(file)),
    JSON.stringify(toFtcComplaint(file)),
    toMarkdown(file),
  ].join('\n');

  assert.doesNotMatch(rendered, /4111[ -]?1111[ -]?1111[ -]?1111/);
  assert.doesNotMatch(rendered, /021000021/);
  assert.doesNotMatch(rendered, /123456789012/);
  assert.match(rendered, /\*+1111/);
  assert.match(rendered, /\*+0021/);
  assert.match(rendered, /\*+9012/);
});
