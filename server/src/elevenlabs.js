import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, TRANSPORTS } from './config.js';

// The input-streaming websocket rejects these outright with unsupported_model.
const WEBSOCKET_INCOMPATIBLE = /^eleven_v3/;

/** Can this model be driven over the input-streaming websocket? */
export function supportsWebsocket(model) {
  if (!model) return true;
  return !WEBSOCKET_INCOMPATIBLE.test(String(model));
}

const SENTENCE_ABBR = /(?:^|\s)(mr|mrs|ms|dr|st|jr|sr|prof|rev|lt|sgt|capt|dept|apt|no|vs|etc|inc|ltd|co)$/i;

/**
 * Pull completed sentences off a growing buffer.
 *
 * The HTTP path synthesizes each sentence as it arrives instead of waiting for
 * the whole reply, because request latency scales with the text sent. An
 * unterminated tail stays in the buffer so no word is ever cut in half.
 */
export function takeSentences(buffer) {
  const input = String(buffer ?? '');
  const sentences = [];
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;

    const next = input[i + 1];
    // No lookahead yet means the sentence may not be over.
    if (next === undefined) break;
    if (!/\s/.test(next)) continue;

    const head = input.slice(start, i);
    if (c === '.' && SENTENCE_ABBR.test(head)) continue;
    if (c === '.' && /(?:^|[\s.])[A-Z]$/.test(head)) continue;

    sentences.push(input.slice(start, i + 1));
    start = i + 1;
  }

  return { sentences, rest: input.slice(start) };
}

const FILLER_DIR = path.resolve(process.cwd(), 'data', 'fillers');

/** Identity of one cached filler clip. Voice, model and codec all change the audio. */
export function fillerCacheKey(voiceId, model, outputFormat, text) {
  const digest = crypto
    .createHash('sha1')
    .update([voiceId, model, outputFormat, text].join('\u0000'))
    .digest('hex')
    .slice(0, 16);
  return `${String(voiceId).replace(/[^A-Za-z0-9]/g, '')}-${digest}.raw`;
}

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
    this.ws = new WebSocket(url, { headers: { 'xi-api-key': config.elevenlabs.key } });

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


/**
 * HTTP synthesis, for models the websocket refuses.
 *
 * Presents the same push/end/cancel surface as the streaming client, but holds
 * the text until end() and sends it in one request. That suits reply
 * granularity, where the whole utterance is buffered before synthesis anyway.
 *
 * speakNow() exists because the filler must not wait for the model to finish
 * writing. Fillers are a fixed set of fixed phrases, so their audio is cached
 * to disk on first use and replayed instantly afterwards.
 */
export class ElevenLabsBatch {
  constructor({ voiceId, voiceSettings, onAudio, onDone, onError, transport = 'browser' }) {
    this.outputFormat = (TRANSPORTS[transport] || TRANSPORTS.browser).tts.outputFormat;
    this.voiceId = voiceId;
    this.voiceSettings = voiceSettings || { stability: 0.5, similarity_boost: 0.8 };
    this.onAudio = onAudio || (() => {});
    this.onDone = onDone || (() => {});
    this.onError = onError || (() => {});
    this.buffer = '';
    this.cancelled = false;
    this.controller = new AbortController();
    this.slots = [];
    this.jobs = [];
    this.nextEmit = 0;
  }

  get immediate() {
    return true;
  }

  push(text) {
    if (!text || this.cancelled) return;
    this.buffer += text;
    const { sentences, rest } = takeSentences(this.buffer);
    this.buffer = rest;
    for (const sentence of sentences) {
      if (sentence.trim()) this.#dispatch(sentence);
    }
  }

  /**
   * Start synthesizing one sentence.
   *
   * Requests may be in flight together, but each writes into its own ordered
   * slot and audio is released only from the head. Emitting as responses land
   * would rearrange the persona's words.
   */
  #dispatch(text) {
    const slot = { chunks: [], done: false };
    this.slots.push(slot);

    const job = (async () => {
      try {
        const res = await this.#open(text);
        for await (const chunk of res.body) {
          if (this.cancelled) return;
          slot.chunks.push(Buffer.from(chunk));
          this.#drain();
        }
      } catch (err) {
        if (!this.cancelled && err?.name !== 'AbortError') this.onError(err);
      } finally {
        slot.done = true;
        this.#drain();
      }
    })();

    this.jobs.push(job);
  }

  /** Release audio from the head slot only, advancing as each finishes. */
  #drain() {
    while (this.nextEmit < this.slots.length) {
      const slot = this.slots[this.nextEmit];
      while (slot.chunks.length) {
        const chunk = slot.chunks.shift();
        if (!this.cancelled) this.onAudio(chunk, null);
      }
      if (!slot.done) break;
      this.nextEmit++;
    }
  }

  /** Speak a fixed phrase right away, from disk when we have heard it before. */
  async speakNow(text) {
    if (!text || this.cancelled) return;
    const key = fillerCacheKey(this.voiceId, config.elevenlabs.model, this.outputFormat, text);
    const file = path.join(FILLER_DIR, key);

    try {
      const cached = fs.readFileSync(file);
      if (!this.cancelled) this.onAudio(cached, null);
      return;
    } catch {
      // not cached yet
    }

    try {
      const pcm = await this.#request(text);
      if (this.cancelled) return;
      this.onAudio(pcm, null);
      try {
        fs.mkdirSync(FILLER_DIR, { recursive: true });
        fs.writeFileSync(file, pcm);
      } catch {
        // a cold cache is slower, never fatal
      }
    } catch (err) {
      if (!this.cancelled) this.onError(err);
    }
  }

  async end() {
    const tail = this.buffer.trim();
    this.buffer = '';
    if (tail) this.#dispatch(tail);

    // Jobs can queue more jobs, so settle until nothing new appears.
    let settled = 0;
    while (settled < this.jobs.length) {
      const pending = this.jobs.slice(settled);
      settled = this.jobs.length;
      await Promise.allSettled(pending);
    }

    this.#drain();
    if (!this.cancelled) this.onDone();
  }

  async #open(text) {
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream` +
      `?output_format=${this.outputFormat}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: this.controller.signal,
      headers: { 'xi-api-key': config.elevenlabs.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: config.elevenlabs.model,
        voice_settings: this.voiceSettings,
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async #request(text) {
    const res = await this.#open(text);
    return Buffer.from(await res.arrayBuffer());
  }

  cancel() {
    this.cancelled = true;
    try {
      this.controller.abort();
    } catch {}
  }

  close() {
    this.cancel();
  }
}

/**
 * Build the voice for the configured model. Both implementations expose
 * push/end/cancel, so a session does not care which one it is driving.
 */
export function createVoice(options) {
  return supportsWebsocket(config.elevenlabs.model)
    ? new ElevenLabsStream(options).connect()
    : new ElevenLabsBatch(options);
}

/** Non-streaming helper for one-shot lines (session openers, pre-roll fillers). */
export async function synthesizeOnce(voiceId, text, voiceSettings, transport = 'browser') {
  const fmt = (TRANSPORTS[transport] || TRANSPORTS.browser).tts.outputFormat;
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
    `?output_format=${fmt}`;
  const res = await fetch(url, {
    method: 'POST',
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
