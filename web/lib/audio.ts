/**
 * Browser audio engine.
 *
 * Capture runs in a 16kHz AudioContext so the PCM we ship to Deepgram needs no
 * resampling. Playback runs in a separate 24kHz context matching ElevenLabs'
 * PCM output, so agent audio is scheduled sample-accurate with no decode step
 * and no seam between streamed chunks.
 */

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;
const SCHEDULE_LEAD = 0.08; // seconds of cushion before the first chunk plays

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
  private outGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRaf = 0;

  private sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private playingTurn = -1;
  private queuedForTurn = 0;

  constructor(private h: AudioEngineHandlers) {}

  get micActive() {
    return !!this.stream;
  }

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

  async ensurePlayback() {
    if (this.playbackCtx) {
      if (this.playbackCtx.state === 'suspended') await this.playbackCtx.resume();
      return;
    }
    this.playbackCtx = new AudioContext({ sampleRate: PLAYBACK_RATE });
    this.outGain = this.playbackCtx.createGain();
    this.analyser = this.playbackCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.outGain.connect(this.analyser).connect(this.playbackCtx.destination);
    await this.playbackCtx.resume();
    this.#pumpOutputLevel();
  }

  #pumpOutputLevel() {
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

  /** Queue one streamed PCM16 chunk belonging to `turnId`. */
  enqueue(turnId: number, pcm: ArrayBuffer) {
    const ctx = this.playbackCtx;
    if (!ctx || !this.outGain) return;

    if (turnId !== this.playingTurn) {
      this.playingTurn = turnId;
      this.queuedForTurn = 0;
      this.nextStart = Math.max(ctx.currentTime + SCHEDULE_LEAD, this.nextStart);
    }

    const i16 = new Int16Array(pcm);
    if (!i16.length) return;

    const buffer = ctx.createBuffer(1, i16.length, PLAYBACK_RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outGain);

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
    cancelAnimationFrame(this.levelRaf);
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.captureCtx?.close().catch(() => {});
    this.captureCtx = null;
    await this.playbackCtx?.close().catch(() => {});
    this.playbackCtx = null;
    this.analyser = null;
    this.outGain = null;
  }
}
