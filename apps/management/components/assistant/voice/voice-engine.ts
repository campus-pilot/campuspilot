import { VOICE_OUTPUT_SAMPLE_RATE } from '@campuspilot/assistant-contract/voice';

/**
 * The browser's side of the audio: the microphone in, the assistant's voice
 * out, and how loud each is right now (which the avatar follows, so it never
 * moves without sound).
 *
 * One `AudioContext` does both. The microphone goes through a worklet
 * (`public/assistant-voice-capture.js`) that hands over 16 kHz PCM chunks.
 * The assistant's voice arrives as 24 kHz PCM frames, each scheduled right
 * after the one before, so speech plays without gaps whatever the network's
 * rhythm. The microphone is opened with the browser's echo cancellation, so
 * the assistant does not hear itself through the speakers.
 */

/** The worklet's file and registered name (`public/assistant-voice-capture.js`). */
const CAPTURE_MODULE_URL = '/assistant-voice-capture.js';
const CAPTURE_PROCESSOR = 'assistant-voice-capture';

/** How far ahead of "now" the first frame after a silence is scheduled, so it never starts in the past. */
const PLAYBACK_LEAD_SECONDS = 0.03;

export type VoiceLevels = {
  /** How loud the microphone is, 0 to 1; 0 while it is closed. */
  input: number;
  /** How loud the assistant's voice is, 0 to 1. */
  output: number;
};

export type VoiceEngine = {
  /**
   * Makes the audio device ready. Call it synchronously inside the user's
   * click, before anything is awaited: some browsers (Safari) only let audio
   * start from the click itself, and `start` runs after the microphone prompt.
   */
  prime(): void;
  /**
   * Opens the microphone (the browser asks the user the first time) and starts
   * handing over its audio. Rejects with the browser's `DOMException` when the
   * microphone is refused or missing.
   */
  start(onChunk: (pcm: ArrayBuffer) => void): Promise<void>;
  /** Closes or opens the microphone. While closed no chunk is handed over and the device sends silence. */
  setMuted(muted: boolean): void;
  /** Queues a frame of the assistant's voice (16-bit little-endian mono PCM at the output rate). */
  play(pcm: ArrayBuffer): void;
  /** Stops the assistant's voice now and drops what is queued (the user spoke over it). */
  flush(): void;
  levels(): VoiceLevels;
  /** Releases the microphone and the audio device. */
  stop(): void;
};

/** The loudness of an analyser's current window, 0 to 1 (speech at a normal distance lands around 0.3 to 0.8). */
function levelOf(analyser: AnalyserNode | null, buffer: Float32Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 5);
}

/**
 * @param onPlaying Called when the assistant's voice starts and stops playing.
 */
export function createVoiceEngine(onPlaying: (playing: boolean) => void): VoiceEngine {
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let capture: AudioWorkletNode | null = null;
  let inputAnalyser: AnalyserNode | null = null;
  let outputAnalyser: AnalyserNode | null = null;
  let muted = false;
  /** When the last queued frame ends, on the context's clock. */
  let playUntil = 0;
  let playing = false;
  let playingTimer: ReturnType<typeof setTimeout> | null = null;
  const sources = new Set<AudioBufferSourceNode>();
  const window = new Float32Array(512);

  /** Reports `playing` now, and schedules the report of its end for when the queue runs out. */
  const trackPlaying = () => {
    if (!context) return;
    if (playingTimer) clearTimeout(playingTimer);
    const remaining = playUntil - context.currentTime;
    const now = remaining > 0;
    if (now !== playing) {
      playing = now;
      onPlaying(now);
    }
    if (now) playingTimer = setTimeout(trackPlaying, remaining * 1000 + 20);
  };

  return {
    prime() {
      if (context) return;
      context = new AudioContext({ latencyHint: 'interactive' });
      void context.resume().catch(() => undefined);
    },

    async start(onChunk) {
      this.prime();
      const audio = context;
      if (!audio) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      // Stopped while the browser was asking for the microphone.
      if (context !== audio) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
        return;
      }
      await audio.audioWorklet.addModule(CAPTURE_MODULE_URL);
      await audio.resume();
      if (context !== audio) return;

      const microphone = audio.createMediaStreamSource(stream);
      inputAnalyser = audio.createAnalyser();
      inputAnalyser.fftSize = window.length;
      microphone.connect(inputAnalyser);
      capture = new AudioWorkletNode(audio, CAPTURE_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1 });
      capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!muted) onChunk(event.data);
      };
      microphone.connect(capture);
      // Some browsers only run a node that reaches the output. This path is silent: the microphone is never played back.
      const silent = audio.createGain();
      silent.gain.value = 0;
      capture.connect(silent).connect(audio.destination);

      outputAnalyser = audio.createAnalyser();
      outputAnalyser.fftSize = window.length;
      outputAnalyser.connect(audio.destination);
    },

    setMuted(next) {
      muted = next;
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = !next;
    },

    play(pcm) {
      if (!context || !outputAnalyser || pcm.byteLength < 2) return;
      const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
      const buffer = context.createBuffer(1, samples.length, VOICE_OUTPUT_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index]! / 0x8000;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(outputAnalyser);
      const startAt = Math.max(context.currentTime + PLAYBACK_LEAD_SECONDS, playUntil);
      source.start(startAt);
      playUntil = startAt + buffer.duration;
      sources.add(source);
      source.onended = () => sources.delete(source);
      trackPlaying();
    },

    flush() {
      for (const source of sources) {
        source.onended = null;
        source.stop();
      }
      sources.clear();
      playUntil = 0;
      trackPlaying();
    },

    levels() {
      return { input: muted ? 0 : levelOf(inputAnalyser, window), output: levelOf(outputAnalyser, window) };
    },

    stop() {
      if (playingTimer) clearTimeout(playingTimer);
      for (const source of sources) source.onended = null;
      sources.clear();
      if (capture) capture.port.onmessage = null;
      for (const track of stream?.getTracks() ?? []) track.stop();
      void context?.close().catch(() => undefined);
      context = null;
      stream = null;
      capture = null;
      inputAnalyser = null;
      outputAnalyser = null;
      playUntil = 0;
      if (playing) {
        playing = false;
        onPlaying(false);
      }
    },
  };
}
