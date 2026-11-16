/**
 * Microphone capture for the assistant's voice mode, as an AudioWorklet (it
 * runs on the audio thread, so speech is never dropped while the page is
 * busy). It turns the microphone's audio, at whatever rate the device runs,
 * into 16 kHz 16-bit mono PCM in chunks of 40 ms, and posts each chunk to the
 * page (`voice-engine.ts`), which sends it to the API server.
 *
 * Downsampling averages the input samples that fall into each output sample
 * (a box filter): enough to keep speech clean without a filter design, since
 * the voice model only needs speech.
 *
 * A plain script, not a module of the app: the browser loads worklets by URL.
 * Keep `OUTPUT_RATE` and the processor's name in step with `voice-engine.ts`.
 */
const OUTPUT_RATE = 16000;
const CHUNK_SAMPLES = 640;

class AssistantVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Input samples per output sample; `sampleRate` is the audio context's rate. */
    this.step = sampleRate / OUTPUT_RATE;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let index = 0; index < input.length; index += 1) {
      this.sum += input[index];
      this.count += 1;
      this.phase += 1;
      if (this.phase < this.step) continue;
      this.phase -= this.step;
      const sample = Math.max(-1, Math.min(1, this.sum / this.count));
      this.chunk[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.filled += 1;
      this.sum = 0;
      this.count = 0;
      if (this.filled === CHUNK_SAMPLES) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(CHUNK_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('assistant-voice-capture', AssistantVoiceCapture);
