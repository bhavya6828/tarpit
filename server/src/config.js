const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),

  deepgram: {
    key: process.env.DEEPGRAM_API_KEY || '',
    model: process.env.DEEPGRAM_MODEL || 'nova-3',
  },

  elevenlabs: {
    key: process.env.ELEVENLABS_API_KEY || '',
    model: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
    // 24kHz PCM: no decode step in the browser, no gaps between chunks.
    outputFormat: 'pcm_24000',
    sampleRate: 24000,
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
};

export function missingKeys() {
  const missing = [];
  if (!config.deepgram.key) missing.push('DEEPGRAM_API_KEY');
  if (!config.elevenlabs.key) missing.push('ELEVENLABS_API_KEY');
  if (!config.openai.key) missing.push('OPENAI_API_KEY');
  return missing;
}
