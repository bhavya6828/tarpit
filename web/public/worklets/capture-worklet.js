/**
 * Mic capture worklet. Accumulates 512-sample frames (32ms at 16kHz) before
 * posting to the main thread — small enough that barge-in still feels instant,
 * large enough that we're not flooding the message port at 128 samples a pop.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.frame[this.filled++] = channel[i];
      if (this.filled === this.frame.length) {
        let peak = 0;
        for (let j = 0; j < this.frame.length; j++) {
          const a = this.frame[j] < 0 ? -this.frame[j] : this.frame[j];
          if (a > peak) peak = a;
        }
        this.port.postMessage({ pcm: this.frame.slice(0), peak }, []);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
