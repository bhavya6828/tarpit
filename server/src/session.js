import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DeepgramStream } from './deepgram.js';
import { ElevenLabsStream } from './elevenlabs.js';
import { openai, streamPersonaReply, pick } from './brain.js';
import { getPersona, DEFAULT_PERSONA } from './personas.js';
import { extractIntel, detectSignals, enrichIntel } from './intel.js';
import { store } from './elastic.js';
import { config } from './config.js';

/** Did this error come from us deliberately cancelling the request? */
function isAbort(err) {
  if (!err) return false;
  return (
    err.name === 'AbortError' ||
    err.name === 'APIUserAbortError' ||
    /abort/i.test(err.message || '')
  );
}

const IDLE_NUDGE_MS = 9000;      // scammer silent this long → agent fills the gap
const ENRICH_EVERY_TURNS = 3;    // LLM intel enrichment cadence
const SPEAK_GRACE_MS = 700;      // ignore barge-in right after agent starts talking

/**
 * One engagement. Owns the full loop:
 *
 *   mic PCM ──► Deepgram ──► turn detection ──► OpenAI persona ──► ElevenLabs
 *                    │                                                  │
 *                    └──► intel extraction ──► Elastic          PCM ────┘──► browser
 */
export class Session extends EventEmitter {
  constructor({ personaId = DEFAULT_PERSONA, transport = 'browser', caller = null } = {}) {
    super();
    this.id = randomUUID().slice(0, 8);
    this.persona = getPersona(personaId);
    this.transport = transport;
    // Telephony forensics for a real inbound call; null for the browser demo.
    this.caller = caller;
    this.status = 'idle';

    this.history = [];
    this.transcript = [];
    this.seenIntel = new Set();
    this.intel = [];
    this.enrichment = null;

    this.startedAt = null;
    this.endedAt = null;
    this.turnCount = 0;
    this.interruptions = 0;

    this.dg = null;
    this.tts = null;
    this.abort = null;

    this.agentSpeaking = false;
    this.turnInFlight = false;
    this.turnId = 0;
    this.speakStartedAt = 0;
    this.pendingUtterance = '';
    this.muteWhileSpeaking = false;

    this.metricsTimer = null;
    this.idleTimer = null;
  }

  // ─── lifecycle ────────────────────────────────────────────────────────────

  async start() {
    if (this.status === 'live') return;
    this.status = 'live';
    this.startedAt = Date.now();
    this.emit('event', {
      type: 'session_start',
      sessionId: this.id,
      persona: this.#personaCard(),
      transport: this.transport,
      caller: this.caller,
    });
    if (this.caller) this.#harvestCaller();

    this.dg = new DeepgramStream({
      transport: this.transport,
      onOpen: () => this.emit('event', { type: 'stt_ready' }),
      onTranscript: (t) => this.#onTranscript(t),
      onUtteranceEnd: () => this.#flushTurn('utterance_end'),
      onSpeechStarted: () => this.#onSpeechStarted(),
      onError: (e) => this.emit('event', { type: 'error', scope: 'deepgram', message: e.message }),
    }).connect();

    this.metricsTimer = setInterval(() => this.emit('event', { type: 'metrics', ...this.metrics() }), 500);
    this.#armIdleTimer();

    await store.upsertSession(this.#sessionDoc());

    // A real person says hello the moment they pick up.
    const opener = pick(this.persona.openers);
    this.#speak(opener, { isOpener: true });
  }

  async stop(reason = 'operator_ended') {
    if (this.status === 'ended') return this.metrics();
    this.status = 'ended';
    this.endedAt = Date.now();

    clearInterval(this.metricsTimer);
    clearTimeout(this.idleTimer);
    this.#cancelAgentTurn();
    this.dg?.close();
    this.dg = null;

    const m = this.metrics();
    if (openai && this.transcript.length > 1) {
      this.enrichment = (await enrichIntel(openai, config.openai.extractModel, this.#plainTranscript())) || this.enrichment;
    }
    await store.upsertSession(this.#sessionDoc());
    this.emit('event', { type: 'session_end', reason, ...m, enrichment: this.enrichment });
    return m;
  }

  setPersona(personaId) {
    const next = getPersona(personaId);
    if (!next || next.id === this.persona.id) return;
    this.persona = next;
    // Mid-call persona swap: the caller "hands the phone to someone else".
    this.history.push({
      role: 'system',
      content: `The person on your end has changed. You are now a different member of the household who just took the phone. Briefly acknowledge the handoff in character, then continue keeping the caller on the line.`,
    });
    this.emit('event', { type: 'persona_changed', persona: this.#personaCard() });
  }

  setMuteWhileSpeaking(on) {
    this.muteWhileSpeaking = !!on;
    this.emit('event', { type: 'state', muteWhileSpeaking: this.muteWhileSpeaking });
  }

  /** Browser tells us playback actually finished — more accurate than TTS "done". */
  notePlaybackDone(turnId) {
    if (turnId === this.turnId) {
      this.agentSpeaking = false;
      this.emit('event', { type: 'state', agentSpeaking: false });
      this.#armIdleTimer();
    }
  }

  pushAudio(buf) {
    if (this.status !== 'live') return;

    // Half-duplex option for demoing on loudspeakers without echo feeding back.
    //
    // We substitute silence rather than sending nothing. Deepgram endpoints an
    // utterance by *hearing* the pause after it — a stream that simply goes dead
    // leaves the previous utterance unfinalized forever, so the last thing the
    // caller said before we started talking would never be transcribed or mined.
    if (this.muteWhileSpeaking && this.agentSpeaking) {
      this.dg?.send(this.#silenceLike(buf));
      return;
    }

    this.dg?.send(buf);
  }

  #silenceLike(buf) {
    if (!this.silenceFrame || this.silenceFrame.length !== buf.length) {
      this.silenceFrame = Buffer.alloc(buf.length);
    }
    return this.silenceFrame;
  }

  /**
   * Feed text as if the caller had spoken it. Powers the UI's type-to-talk box,
   * which doubles as the demo's safety net if a mic or the venue noise floor
   * turns against us.
   */
  injectScammerText(text) {
    if (this.status !== 'live' || !text?.trim()) return;
    const clean = text.trim();
    const entry = {
      session_id: this.id,
      speaker: 'scammer',
      text: clean,
      persona: this.persona.id,
      injected: true,
      '@timestamp': new Date().toISOString(),
    };
    this.transcript.push(entry);
    this.emit('event', { type: 'transcript', speaker: 'scammer', text: clean, final: true, injected: true });
    store.indexUtterance(entry);
    this.#harvest(clean, 'scammer');

    if (this.agentSpeaking) {
      this.interruptions++;
      this.#cancelAgentTurn();
      this.emit('event', { type: 'interrupted', turnId: this.turnId, interruptions: this.interruptions });
    }
    this.pendingUtterance = clean;
    this.#flushTurn('injected');
  }

  // ─── STT handling ─────────────────────────────────────────────────────────

  #onSpeechStarted() {
    this.emit('event', { type: 'vad', speaking: true });
  }

  #onTranscript({ text, isFinal, speechFinal, confidence }) {
    if (this.status !== 'live') return;

    if (!isFinal) {
      this.emit('event', { type: 'transcript_partial', speaker: 'scammer', text });
      this.#maybeBargeIn(text);
      return;
    }

    this.pendingUtterance = `${this.pendingUtterance} ${text}`.trim();
    this.#armIdleTimer();

    const entry = {
      session_id: this.id,
      speaker: 'scammer',
      text,
      confidence,
      persona: this.persona.id,
      '@timestamp': new Date().toISOString(),
    };
    this.transcript.push(entry);
    this.emit('event', { type: 'transcript', speaker: 'scammer', text, final: true });
    store.indexUtterance(entry);

    this.#harvest(text, 'scammer');

    if (speechFinal) this.#flushTurn('speech_final');
  }

  /**
   * Barge-in. We deliberately do NOT trigger on raw VAD — on a laptop the
   * persona's own voice bleeds into the mic. Requiring a couple of recognized
   * words plus a short grace window makes interruption feel human without the
   * agent talking over itself.
   */
  #maybeBargeIn(text) {
    if (!this.agentSpeaking) return;
    if (Date.now() - this.speakStartedAt < SPEAK_GRACE_MS) return;
    if (text.trim().split(/\s+/).length < 2) return;

    this.interruptions++;
    this.#cancelAgentTurn();
    this.emit('event', { type: 'interrupted', turnId: this.turnId, interruptions: this.interruptions });
  }

  #flushTurn(cause) {
    const text = this.pendingUtterance.trim();
    if (!text || this.turnInFlight) return;
    this.pendingUtterance = '';
    this.#runTurn(text, cause);
  }

  // ─── Agent turn ───────────────────────────────────────────────────────────

  async #runTurn(scammerText, cause) {
    this.turnInFlight = true;
    this.turnCount++;
    this.history.push({ role: 'user', content: scammerText });

    const signals = detectSignals(scammerText);
    if (signals.length) this.emit('event', { type: 'signals', signals, cause });

    let spoken = '';
    try {
      const filler = pick(this.persona.fillers);
      const stream = streamPersonaReply({
        persona: this.persona,
        history: this.history,
        tactics: signals,
        elapsedSeconds: this.elapsedSeconds(),
        signal: (this.abort = new AbortController()).signal,
      });

      spoken = await this.#speak(filler, { prefixOf: stream });
    } catch (err) {
      // A barge-in aborts the in-flight completion on purpose. The OpenAI SDK
      // surfaces that as a plain error rather than a DOMException, so match on
      // the message too — otherwise every interruption paints a red error in
      // the command center mid-demo.
      if (!isAbort(err)) {
        this.emit('event', { type: 'error', scope: 'brain', message: err.message });
      }
    }

    if (spoken.trim()) {
      this.history.push({ role: 'assistant', content: spoken.trim() });
    }

    this.turnInFlight = false;
    this.#armIdleTimer();

    if (this.turnCount % ENRICH_EVERY_TURNS === 0) this.#enrich();
    store.upsertSession(this.#sessionDoc());

    // Anything the scammer said while we were replying gets handled now.
    if (this.pendingUtterance.trim()) this.#flushTurn('queued');
  }

  /**
   * Drive one TTS generation. `text` is spoken immediately (the filler, or a
   * fixed line); `prefixOf` is an optional async iterator of LLM deltas that
   * continue the same utterance. Speaking the filler first means audio starts
   * ~instantly while the model is still writing.
   */
  async #speak(text, { prefixOf = null, isOpener = false } = {}) {
    const turnId = ++this.turnId;
    this.agentSpeaking = true;
    this.speakStartedAt = Date.now();
    clearTimeout(this.idleTimer);

    this.emit('event', { type: 'audio_start', turnId, persona: this.persona.id });
    this.emit('event', { type: 'state', agentSpeaking: true });

    let full = '';
    const tts = new ElevenLabsStream({
      transport: this.transport,
      voiceId: this.persona.voiceId,
      voiceSettings: this.persona.voiceSettings,
      onAudio: (pcm) => {
        if (turnId === this.turnId) this.emit('audio', { turnId, pcm });
      },
      onDone: () => this.emit('event', { type: 'audio_end', turnId }),
      onError: (e) => this.emit('event', { type: 'error', scope: 'elevenlabs', message: e.message }),
    });
    this.tts = tts;
    tts.connect();

    const say = (chunk) => {
      if (turnId !== this.turnId) return;
      full += chunk;
      tts.push(chunk);
      this.emit('event', { type: 'agent_delta', turnId, text: chunk });
    };

    if (text) say(`${text} `);

    if (prefixOf) {
      for await (const delta of prefixOf) {
        if (turnId !== this.turnId) break; // interrupted
        say(delta.replace(/[*_`#]/g, ''));
      }
    }

    tts.end();

    const finalText = full.trim();
    if (finalText) {
      const entry = {
        session_id: this.id,
        speaker: 'persona',
        text: finalText,
        persona: this.persona.id,
        '@timestamp': new Date().toISOString(),
      };
      this.transcript.push(entry);
      this.emit('event', {
        type: 'transcript',
        speaker: 'persona',
        text: finalText,
        final: true,
        turnId,
        isOpener,
      });
      store.indexUtterance(entry);
    }

    // Safety net in case the browser never reports playback completion.
    setTimeout(() => this.notePlaybackDone(turnId), 2000 + finalText.length * 70);
    return full;
  }

  #cancelAgentTurn() {
    try {
      this.abort?.abort();
    } catch {}
    this.abort = null;
    this.tts?.cancel();
    this.tts = null;
    this.agentSpeaking = false;
    this.turnId++; // invalidate any in-flight audio for the old turn
    this.emit('event', { type: 'audio_flush' });
  }

  // ─── Intel ────────────────────────────────────────────────────────────────

  /**
   * Turn inbound-call metadata into indexed artifacts.
   *
   * This is the intel a phone call actually yields. There is no IP address to
   * read off a PSTN call — the audio arrives over the carrier network — but the
   * signalling carries the caller ID, the originating carrier, the line type,
   * and a STIR/SHAKEN attestation saying whether that caller ID was
   * cryptographically vouched for or is very likely spoofed.
   */
  #harvestCaller() {
    const c = this.caller;
    const items = [];
    const mk = (type, label, value, severity, meta) => ({
      id: `${this.id}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      session_id: this.id,
      type,
      label,
      value,
      severity,
      score: { critical: 95, high: 75, medium: 50, low: 25 }[severity] ?? 40,
      speaker: 'network',
      meta: meta || {},
      source_utterance: 'inbound call signalling',
      '@timestamp': new Date().toISOString(),
    });

    if (c.from) {
      items.push(mk('origin_number', 'Originating number', c.from, 'high', {
        e164: c.from,
        city: c.fromCity || '—',
        state: c.fromState || '—',
        country: c.fromCountry || '—',
      }));
    }
    if (c.carrier || c.lineType) {
      items.push(mk('carrier', 'Originating carrier', c.carrier || 'unknown', 'medium', {
        line_type: c.lineType || 'unknown',
        mobile_country_code: c.mcc || '—',
        mobile_network_code: c.mnc || '—',
      }));
    }
    if (c.attestation) {
      const spoofed = c.attestation === 'C' || c.attestation === 'failed';
      items.push(
        mk('caller_id_attestation', 'STIR/SHAKEN attestation', c.attestationLabel || c.attestation, spoofed ? 'critical' : 'medium', {
          attestation: c.attestation,
          verdict: c.attestationVerdict || '—',
          verstat: c.verstat || '—',
        })
      );
    }
    if (c.callerName) {
      items.push(mk('caller_name', 'CNAM (claimed caller ID name)', c.callerName, 'medium', { source: 'CNAM lookup' }));
    }

    if (!items.length) return;
    this.intel.push(...items);
    for (const item of items) this.emit('event', { type: 'intel', item });
    store.indexIntel(items);
  }

  #harvest(text, speaker) {
    const found = extractIntel(text, { sessionId: this.id, speaker, seen: this.seenIntel });
    if (!found.length) return;
    this.intel.push(...found);
    for (const item of found) this.emit('event', { type: 'intel', item });
    store.indexIntel(found);
  }

  async #enrich() {
    if (!openai) return;
    const result = await enrichIntel(openai, config.openai.extractModel, this.#plainTranscript());
    if (result) {
      this.enrichment = result;
      this.emit('event', { type: 'enrichment', enrichment: result });
    }
  }

  #plainTranscript() {
    return this.transcript
      .map((t) => `${t.speaker === 'scammer' ? 'CALLER' : 'TARGET'}: ${t.text}`)
      .join('\n');
  }

  // ─── Idle handling ────────────────────────────────────────────────────────

  #armIdleTimer() {
    clearTimeout(this.idleTimer);
    if (this.status !== 'live') return;
    this.idleTimer = setTimeout(() => {
      if (this.status !== 'live' || this.agentSpeaking || this.turnInFlight) return;
      if (!this.history.length) return;
      this.#nudge();
    }, IDLE_NUDGE_MS);
  }

  async #nudge() {
    this.turnInFlight = true;
    try {
      const stream = streamPersonaReply({
        persona: this.persona,
        history: this.history,
        tactics: ['long_silence'],
        elapsedSeconds: this.elapsedSeconds(),
        signal: (this.abort = new AbortController()).signal,
      });
      const spoken = await this.#speak('', { prefixOf: stream });
      if (spoken.trim()) this.history.push({ role: 'assistant', content: spoken.trim() });
      this.emit('event', { type: 'nudge' });
    } catch {}
    this.turnInFlight = false;
    this.#armIdleTimer();
  }

  // ─── Metrics ──────────────────────────────────────────────────────────────

  elapsedSeconds() {
    if (!this.startedAt) return 0;
    return ((this.endedAt || Date.now()) - this.startedAt) / 1000;
  }

  metrics() {
    const seconds = this.elapsedSeconds();
    const cost = (seconds / 60) * config.economics.costPerMinute;
    return {
      sessionId: this.id,
      status: this.status,
      secondsWasted: seconds,
      costDestroyed: cost,
      victimsShielded: seconds / config.economics.avgScamCallSeconds,
      turns: this.turnCount,
      interruptions: this.interruptions,
      intelCount: this.intel.length,
      persona: this.persona.id,
    };
  }

  #personaCard() {
    const { id, name, age, tagline, accent, color } = this.persona;
    return { id, name, age, tagline, accent, color };
  }

  #sessionDoc() {
    const m = this.metrics();
    return {
      session_id: this.id,
      '@timestamp': new Date(this.startedAt || Date.now()).toISOString(),
      persona: this.persona.id,
      transport: this.transport,
      caller_number: this.caller?.from || null,
      caller_carrier: this.caller?.carrier || null,
      caller_attestation: this.caller?.attestation || null,
      status: this.status,
      seconds_wasted: Number(m.secondsWasted.toFixed(2)),
      cost_destroyed_usd: Number(m.costDestroyed.toFixed(4)),
      turns: this.turnCount,
      intel_count: this.intel.length,
      scam_type: this.enrichment?.scam_type || 'unknown',
      claimed_org: this.enrichment?.claimed_org || null,
      payment_rail: this.enrichment?.payment_rail || null,
    };
  }
}
