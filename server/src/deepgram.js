import WebSocket from 'ws';
import { config, TRANSPORTS } from './config.js';

/**
 * Deepgram streaming STT.
 *
 * We lean on three server-side features that matter for turn-taking:
 *   vad_events      → SpeechStarted, which is our barge-in trigger
 *   endpointing     → speech_final, "they stopped talking, go"
 *   utterance_end_ms→ UtteranceEnd backstop when endpointing misses
 *   numerals        → "four two four two" comes back as digits, which the
 *                     intel extractor needs to checksum card/routing numbers
 */
export class DeepgramStream {
  constructor({ onTranscript, onSpeechStarted, onUtteranceEnd, onError, onOpen, transport = 'browser' }) {
    this.audio = (TRANSPORTS[transport] || TRANSPORTS.browser).stt;
    this.onTranscript = onTranscript || (() => {});
    this.onSpeechStarted = onSpeechStarted || (() => {});
    this.onUtteranceEnd = onUtteranceEnd || (() => {});
    this.onError = onError || (() => {});
    this.onOpen = onOpen || (() => {});
    this.ws = null;
    this.ready = false;
    this.closed = false;
    this.queue = [];
    this.keepAlive = null;
  }

  connect() {
    const params = new URLSearchParams({
      model: config.deepgram.model,
      language: 'en-US',
      encoding: this.audio.encoding,
      sample_rate: String(this.audio.sampleRate),
      channels: '1',
      interim_results: 'true',
      utterance_end_ms: '1000',
      vad_events: 'true',
      endpointing: '300',
      smart_format: 'true',
      punctuate: 'true',
      numerals: 'true',
      filler_words: 'true',
    });

    const url = `wss://api.deepgram.com/v1/listen?${params}`;
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${config.deepgram.key}` } });

    this.ws.on('open', () => {
      this.ready = true;
      for (const chunk of this.queue) this.ws.send(chunk);
      this.queue = [];
      this.keepAlive = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
      this.onOpen();
    });

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript || '').trim();
        if (!text) return;
        this.onTranscript({
          text,
          isFinal: !!msg.is_final,
          speechFinal: !!msg.speech_final,
          confidence: alt?.confidence ?? null,
          start: msg.start ?? null,
          duration: msg.duration ?? null,
        });
      } else if (msg.type === 'SpeechStarted') {
        this.onSpeechStarted(msg);
      } else if (msg.type === 'UtteranceEnd') {
        this.onUtteranceEnd(msg);
      }
    });

    this.ws.on('error', (err) => {
      this.ready = false;
      this.onError(err);
    });

    this.ws.on('close', () => {
      this.ready = false;
      clearInterval(this.keepAlive);
    });

    return this;
  }

  /** @param {Buffer} pcm16 mono audio in this transport's encoding */
  send(pcm16) {
    if (this.closed) return;
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm16);
    } else if (this.queue.length < 200) {
      this.queue.push(pcm16);
    }
  }

  /**
   * Deepgram flushes the final transcript only after it receives CloseStream,
   * and it closes the socket itself once it has. Tearing the socket down in the
   * same tick throws that last utterance away — which is exactly the utterance
   * most likely to contain the payment details they blurted before hanging up.
   */
  close() {
    this.closed = true;
    clearInterval(this.keepAlive);

    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    if (ws.readyState !== WebSocket.OPEN) {
      try { ws.close(); } catch {}
      return;
    }

    try {
      ws.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {}

    const hardStop = setTimeout(() => {
      try { ws.close(); } catch {}
    }, 2000);
    ws.once('close', () => clearTimeout(hardStop));
  }
}
