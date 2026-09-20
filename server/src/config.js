const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),

  security: {
    accessToken: process.env.HONEYPOT_ACCESS_TOKEN || '',
    maxConcurrentSessions: Math.max(1, Math.floor(num(process.env.MAX_CONCURRENT_SESSIONS, 4))),
    maxSessionMs: Math.max(1, Math.ceil(num(process.env.MAX_SESSION_MINUTES, 30) * 60_000)),
    providerTimeoutMs: Math.max(1, Math.floor(num(process.env.PROVIDER_TIMEOUT_MS, 5000))),
  },

  deepgram: {
    key: process.env.DEEPGRAM_API_KEY || '',
    model: process.env.DEEPGRAM_MODEL || 'nova-3',
  },

  elevenlabs: {
    key: process.env.ELEVENLABS_API_KEY || '',
    // turbo over flash: +116ms to first byte, audibly better prosody. On a
    // phone call that latency delta is invisible; the quality delta is not.
    model: process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5',
    // 24kHz PCM: no decode step in the browser, no gaps between chunks.
    outputFormat: 'pcm_24000',
    sampleRate: 24000,
    // How much text the voice engine receives at once. 'reply' gives it the
    // whole utterance so it can plan intonation across the entire line, which
    // is the difference between speech and dictation. 'clause' trades some of
    // that back for lower latency.
    granularity: process.env.TTS_GRANULARITY === 'clause' ? 'clause' : 'reply',
  },

  openai: {
    key: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    extractModel: process.env.OPENAI_EXTRACT_MODEL || 'gpt-4o-mini',
  },

  elastic: {
    cloudId: process.env.ELASTIC_CLOUD_ID || '',
    apiKey: process.env.ELASTIC_API_KEY || '',
    node: process.env.ELASTIC_NODE || '',
    username: process.env.ELASTIC_USERNAME || '',
    password: process.env.ELASTIC_PASSWORD || '',
  },

  economics: {
    costPerMinute: num(process.env.SCAMMER_COST_PER_MINUTE, 0.42),
    avgScamCallSeconds: num(process.env.AVG_SCAM_CALL_SECONDS, 270),
  },

  // Mic capture rate the browser ships us; Deepgram is told the same.
  inputSampleRate: 16000,

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    number: process.env.TWILIO_NUMBER || '',
    // Public https origin the phone network can reach (ngrok/cloudflared).
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
    personaId: process.env.TWILIO_PERSONA || 'harold',
  },
};

/**
 * Audio formats differ per transport, so both streaming clients are told which
 * one they're serving rather than reading a global.
 *
 * The phone path deliberately stays in mu-law 8kHz end to end: Deepgram accepts
 * it natively and ElevenLabs emits it natively, so a real call involves zero
 * resampling in our process — fewer moving parts and less latency than
 * converting to PCM and back.
 */
export const TRANSPORTS = {
  browser: {
    stt: { encoding: 'linear16', sampleRate: 16000 },
    tts: { outputFormat: 'pcm_24000', sampleRate: 24000 },
  },
  twilio: {
    stt: { encoding: 'mulaw', sampleRate: 8000 },
    tts: { outputFormat: 'ulaw_8000', sampleRate: 8000 },
  },
};

export function twilioReady() {
  const t = config.twilio;
  const missing = [];
  if (!t.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!t.authToken) missing.push('TWILIO_AUTH_TOKEN');
  if (!t.publicUrl) missing.push('PUBLIC_URL');
  return { ok: missing.length === 0, missing };
}

export function missingKeys() {
  const missing = [];
  if (!config.deepgram.key) missing.push('DEEPGRAM_API_KEY');
  if (!config.elevenlabs.key) missing.push('ELEVENLABS_API_KEY');
  if (!config.openai.key) missing.push('OPENAI_API_KEY');
  return missing;
}
