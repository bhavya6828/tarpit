import WebSocket from 'ws';
import { config, TRANSPORTS } from './config.js';

/**
 * ElevenLabs streaming TTS over the input-streaming websocket.
 *
 * One socket per agent turn. We push LLM tokens in as they arrive, so audio
 * starts coming back before the model has finished writing the sentence —
 * that's what keeps the persona feeling like a person on a phone rather than
 * a system that thinks and then speaks.
 *
 * Output is raw PCM at 24kHz so the browser can queue it straight into Web
 * Audio with no decode step and no seam between chunks.
 */
export class ElevenLabsStream {
  constructor({ voiceId, voiceSettings, onAudio, onDone, onError, transport = 'browser' }) {
    this.outputFormat = (TRANSPORTS[transport] || TRANSPORTS.browser).tts.outputFormat;
    this.voiceId = voiceId;
    this.voiceSettings = voiceSettings || { stability: 0.45, similarity_boost: 0.75 };
    this.onAudio = onAudio || (() => {});
    this.onDone = onDone || (() => {});
    this.onError = onError || (() => {});
    this.ws = null;
    this.ready = false;
    this.cancelled = false;
    this.ended = false;
    this.pending = [];
    this.charCount = 0;
  }

  connect() {
    const params = new URLSearchParams({
      model_id: config.elevenlabs.model,
      output_format: this.outputFormat,
      // auto_mode lets ElevenLabs decide generation boundaries from punctuation,
      // which beats a fixed chunk schedule for conversational speech.
      auto_mode: 'true',
      inactivity_timeout: '20',
    });

    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?${params}`;
    this.ws = new WebSocket(url, {
      headers: { 'xi-api-key': config.elevenlabs.key },
      handshakeTimeout: config.security.providerTimeoutMs,
    });

    this.ws.on('open', () => {
      this.ws.send(
        JSON.stringify({
          text: ' ',
          voice_settings: this.voiceSettings,
        })
      );
      this.ready = true;
      for (const t of this.pending) this._raw(t);
      this.pending = [];
      if (this.ended) this._raw('');
    });

    this.ws.on('message', (raw) => {
      if (this.cancelled) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.audio) {
        this.onAudio(Buffer.from(msg.audio, 'base64'), msg.alignment || null);
      }
      if (msg.isFinal) {
        this.onDone();
        this.close();
      }
      if (msg.error) this.onError(new Error(msg.error));
    });

    this.ws.on('error', (err) => this.onError(err));
    this.ws.on('close', () => {
      this.ready = false;
    });

    return this;
  }

  _raw(text) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(text === '' ? { text: '' } : { text }));
      } catch {}
    }
  }

  /** Feed a token/phrase. ElevenLabs requires a trailing space on each chunk. */
  push(text) {
    if (!text || this.cancelled || this.ended) return;
    this.charCount += text.length;
    const chunk = text.endsWith(' ') ? text : `${text} `;
    if (this.ready) this._raw(chunk);
    else this.pending.push(chunk);
  }

  /** Signal end-of-text; ElevenLabs flushes the remaining audio then sends isFinal. */
  end() {
    if (this.ended || this.cancelled) return;
    this.ended = true;
    if (this.ready) this._raw('');
  }

  /** Barge-in: stop generating immediately and drop anything still in flight. */
  cancel() {
    this.cancelled = true;
    this.close();
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.ready = false;
  }
}

/** Non-streaming helper for one-shot lines (session openers, pre-roll fillers). */
export async function synthesizeOnce(voiceId, text, voiceSettings, transport = 'browser') {
  const fmt = (TRANSPORTS[transport] || TRANSPORTS.browser).tts.outputFormat;
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
    `?output_format=${fmt}`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(config.security.providerTimeoutMs),
    headers: {
      'xi-api-key': config.elevenlabs.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenlabs.model,
      voice_settings: voiceSettings || { stability: 0.45, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
