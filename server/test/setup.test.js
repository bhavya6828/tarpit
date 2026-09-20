import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootFile = (name) => new URL(`../../${name}`, import.meta.url);

test('environment template lists supported settings without secrets', async () => {
  const contents = await readFile(rootFile('.env.example'), 'utf8');
  const expected = [
    'PORT',
    'TARPIT_ACCESS_TOKEN',
    'MAX_CONCURRENT_SESSIONS',
    'MAX_SESSION_MINUTES',
    'PROVIDER_TIMEOUT_MS',
    'DEEPGRAM_API_KEY',
    'DEEPGRAM_MODEL',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_MODEL',
    'TTS_GRANULARITY',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_EXTRACT_MODEL',
    'ELASTIC_CLOUD_ID',
    'ELASTIC_API_KEY',
    'ELASTIC_NODE',
    'ELASTIC_USERNAME',
    'ELASTIC_PASSWORD',
    'SCAMMER_COST_PER_MINUTE',
    'AVG_SCAM_CALL_SECONDS',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_NUMBER',
    'TWILIO_PERSONA',
    'PUBLIC_URL',
    'REPORT_WEBHOOK_URL',
    'VOICE_HAROLD',
    'VOICE_DALE',
    'VOICE_KEVIN',
    'VOICE_BRENDA',
    'NEXT_PUBLIC_TARPIT_SERVER',
    'NEXT_PUBLIC_TARPIT_TOKEN',
  ];
  const entries = new Map(
    contents
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split('=', 2))
  );

  assert.deepEqual([...entries.keys()], expected);
  for (const [key, value] of entries) assert.equal(value, '', `${key} must be blank`);
});

test('README documents deterministic install and PowerShell commands', async () => {
  const contents = await readFile(rootFile('README.md'), 'utf8');

  assert.match(contents, /npm run install:all/);
  assert.match(contents, /npm\.cmd run install:all/);
  assert.match(contents, /npm\.cmd run dev/);
});
