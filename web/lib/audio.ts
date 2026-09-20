/**
 * Browser audio engine.
 *
 * Capture runs in a 16kHz AudioContext so the PCM we ship to Deepgram needs no
 * resampling. Playback runs in a separate 24kHz context matching ElevenLabs'
 * PCM output, so agent audio is scheduled sample-accurate with no decode step
 * and no seam between streamed chunks.
 *
 * Playback also runs through a telephony chain. Studio-clean 24kHz speech is
 * the single biggest reason a synthetic voice reads as fake on a "phone call" —
 * real phone audio is band-limited to roughly 300–3400Hz and heavily
 * compressed. Room ambience is mixed in *before* that filter, because the
 * scammer hears the persona's living room down the same line.
 */

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;
const SCHEDULE_LEAD = 0.08; // seconds of cushion before the first chunk plays

// Narrowband telephony passband.
const PHONE_HIGHPASS = 300;
const PHONE_LOWPASS = 3400;

export interface AudioEngineHandlers {
  onPcm(pcm: ArrayBuffer): void;
  onInputLevel(peak: number): void;
  onOutputLevel(peak: number): void;
  onPlaybackDone(turnId: number): void;
}

export class AudioEngine {
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private levelRaf = 0;

  // playback graph
  private voiceGain: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;

  private ambSource: AudioBufferSourceNode | null = null;
  private hissSource: AudioBufferSourceNode | null = null;
  private ambBuffers = new Map<string, AudioBuffer>();
  private ambienceId: string | null = null;

  private telephony = true;

  private sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private playingTurn = -1;
  private queuedForTurn = 0;

  private h: AudioEngineHandlers;

  constructor(h: AudioEngineHandlers) {
    this.h = h;
  }

  get micActive() {
    return !!this.stream;
  }

  // ─── capture ──────────────────────────────────────────────────────────────

  async startMic() {
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Critical when demoing on laptop speakers — without AEC the persona
        // hears itself and barges in on its own voice.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.captureCtx = new AudioContext({ sampleRate: CAPTURE_RATE });
    await this.captureCtx.audioWorklet.addModule('/worklets/capture-worklet.js');

    const src = this.captureCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.captureCtx, 'capture-processor');

    this.node.port.onmessage = (ev: MessageEvent<{ pcm: Float32Array; peak: number }>) => {
      const { pcm, peak } = ev.data;
      this.h.onInputLevel(peak);

      const i16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.h.onPcm(i16.buffer);
    };

    src.connect(this.node);
    // Worklet must be in the graph to be pulled; a zero-gain sink avoids feedback.
    const sink = this.captureCtx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.captureCtx.destination);

    await this.captureCtx.resume();
  }

  // ─── playback graph ───────────────────────────────────────────────────────

  async ensurePlayback() {
    if (this.playbackCtx) {
      if (this.playbackCtx.state === 'suspended') await this.playbackCtx.resume();
      return;
    }

    const ctx = new AudioContext({ sampleRate: PLAYBACK_RATE });
    this.playbackCtx = ctx;

    this.voiceGain = ctx.createGain();
    this.ambGain = ctx.createGain();
    this.hissGain = ctx.createGain();
    this.voiceGain.gain.value = 1;
    this.ambGain.gain.value = 0; // raised only while a call is live
    this.hissGain.gain.value = 0;

    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';

    // Mild soft-clip: the grit a lossy voice codec leaves on consonants.
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = softClipCurve(1.15);
    this.shaper.oversample = '2x';

    // Phone lines are aggressively levelled; this is what flattens the dynamics
    // into that familiar "someone talking into a handset" sound.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -28;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.12;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;

    // Everything the caller hears goes through the same line.
    this.voiceGain.connect(this.highpass);
    this.ambGain.connect(this.highpass);
    this.hissGain.connect(this.highpass);
    this.highpass.connect(this.lowpass).connect(this.shaper).connect(this.comp);
    this.comp.connect(this.analyser).connect(ctx.destination);

    this.applyTelephony(this.telephony);
    this.startHiss();

    await ctx.resume();
    this.pumpOutputLevel();
  }

  /** Toggle the phone-line coloration. Off = raw studio audio. */
  setTelephony(on: boolean) {
    this.telephony = on;
    this.applyTelephony(on);
  }

  private applyTelephony(on: boolean) {
    if (!this.highpass || !this.lowpass || !this.shaper || !this.comp || !this.hissGain) return;
    const ctx = this.playbackCtx!;
    const t = ctx.currentTime;

    // Rather than rewiring the graph, widen the filters to transparency.
    this.highpass.frequency.setTargetAtTime(on ? PHONE_HIGHPASS : 20, t, 0.02);
    this.lowpass.frequency.setTargetAtTime(on ? PHONE_LOWPASS : 20000, t, 0.02);
    this.shaper.curve = on ? softClipCurve(1.15) : softClipCurve(0.001);
    this.comp.ratio.setTargetAtTime(on ? 6 : 1, t, 0.02);
    this.hissGain.gain.setTargetAtTime(on ? 0.0015 : 0, t, 0.05);
  }

  /**
   * A trace of line noise so the gaps between words are not digitally dead.
   * It should never be audible as hiss on its own; the band-pass and the
   * compressor are what actually sell the phone line.
   */
  private startHiss() {
    const ctx = this.playbackCtx;
    if (!ctx || !this.hissGain || this.hissSource) return;

    const buf = ctx.createBuffer(1, PLAYBACK_RATE * 2, PLAYBACK_RATE);
    const ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < ch.length; i++) {
      // Brown-ish noise reads as line noise; white noise reads as a broken mic.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      ch[i] = last * 3.5;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.hissGain);
    src.start();
    this.hissSource = src;
  }

  // ─── ambience ─────────────────────────────────────────────────────────────

  /** Load and loop the room this persona is sitting in. */
  async setAmbience(personaId: string | null) {
    const ctx = this.playbackCtx;
    if (!ctx || !this.ambGain) return;
    if (personaId === this.ambienceId) return;

    this.ambienceId = personaId;
    this.stopAmbience();
    if (!personaId) return;

    let buf = this.ambBuffers.get(personaId);
    if (!buf) {
      try {
        const res = await fetch(`/ambience/${personaId}.mp3`);
        if (!res.ok) return;
        buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.ambBuffers.set(personaId, buf);
      } catch {
        return; // ambience is a nicety; never let it break the call
      }
    }
    if (this.ambienceId !== personaId) return; // persona changed while loading

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.ambGain);
    src.start();
    this.ambSource = src;

    // Sit far under the voice. Anything you consciously notice is too loud,
    // because it stacks with the hiss and the soft-clip already in the chain.
    this.ambGain.gain.setTargetAtTime(0.028, ctx.currentTime, 0.6);
  }

  stopAmbience() {
    const ctx = this.playbackCtx;
    if (this.ambGain && ctx) this.ambGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const src = this.ambSource;
    this.ambSource = null;
    if (src) {
      try {
        src.stop(ctx ? ctx.currentTime + 0.5 : 0);
      } catch {}
    }
  }

  // ─── level metering ───────────────────────────────────────────────────────

  private pumpOutputLevel() {
    const buf = new Uint8Array(this.analyser!.frequencyBinCount);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i] - 128) / 128;
        if (a > peak) peak = a;
      }
      this.h.onOutputLevel(peak);
      this.levelRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  // ─── streamed voice playback ──────────────────────────────────────────────

  /** Queue one streamed PCM16 chunk belonging to `turnId`. */
  enqueue(turnId: number, pcm: ArrayBuffer) {
    const ctx = this.playbackCtx;
    if (!ctx || !this.voiceGain) return;

    if (turnId !== this.playingTurn) {
      this.playingTurn = turnId;
      this.queuedForTurn = 0;
      this.nextStart = Math.max(ctx.currentTime + SCHEDULE_LEAD, this.nextStart);
    }

    // Defence in depth. The server keeps chunks on sample boundaries, but an odd
    // byte count here throws inside Int16Array and kills playback, so trim
    // rather than trust. A byte-shifted buffer decodes as white noise, which is
    // worse than dropping one sample.
    const usable = pcm.byteLength - (pcm.byteLength % 2);
    if (usable <= 0) return;
    const i16 = new Int16Array(usable === pcm.byteLength ? pcm : pcm.slice(0, usable));
    if (!i16.length) return;

    const buffer = ctx.createBuffer(1, i16.length, PLAYBACK_RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceGain);

    const startAt = Math.max(this.nextStart, ctx.currentTime + 0.01);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;

    this.queuedForTurn++;
    this.sources.add(source);

    source.onended = () => {
      this.sources.delete(source);
      this.queuedForTurn--;
      if (this.queuedForTurn <= 0 && turnId === this.playingTurn) {
        this.h.onPlaybackDone(turnId);
      }
    };
  }

  /** Barge-in: kill everything scheduled and reset the clock. */
  flush() {
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.queuedForTurn = 0;
    this.playingTurn = -1;
    this.nextStart = this.playbackCtx ? this.playbackCtx.currentTime : 0;
  }

  async stop() {
    this.flush();
    this.stopAmbience();
    cancelAnimationFrame(this.levelRaf);
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try {
      this.hissSource?.stop();
    } catch {}
    this.hissSource = null;
    await this.captureCtx?.close().catch(() => {});
    this.captureCtx = null;
    await this.playbackCtx?.close().catch(() => {});
    this.playbackCtx = null;
    this.analyser = null;
    this.voiceGain = null;
    this.ambGain = null;
    this.ambienceId = null;
  }
}

function softClipCurve(drive: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  const d = Math.max(0.001, drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * d) / Math.tanh(d);
  }
  return curve;
}
