import { MAX_VOICE_NOTE_SECONDS, VOICE_NOTE_BITS_PER_SECOND } from "@campuspilot/api/leads/school-onboarding";
import { useState, useSyncExternalStore } from "react";

/** A finished recording, kept as a form value. `url` is an object URL for playback; revoke it when discarded. */
export type RecordedVoiceNote = { blob: Blob; url: string; seconds: number; mimeType: string };

/**
 * Where the recorder is. `denied` means the person (or the browser) refused
 * the microphone; `unsupported` that the browser cannot record at all.
 */
export type RecorderStatus = "idle" | "requesting" | "recording" | "denied" | "unsupported" | "failed";
export type RecorderSnapshot = { status: RecorderStatus; elapsedSeconds: number };

/** Containers in order of preference; the first the browser can record wins (Safari only offers MP4). */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

function pickMimeType() {
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

const IDLE: RecorderSnapshot = { status: "idle", elapsedSeconds: 0 };

/**
 * A microphone recorder as an external store, so components read it with
 * `useSyncExternalStore` and nothing needs an effect. Recording starts from a
 * click, ticks the elapsed time four times a second and stops by itself at
 * {@link MAX_VOICE_NOTE_SECONDS}. `dispose` (called when the recorder's
 * element unmounts) stops the microphone if the person leaves mid-recording.
 */
export class VoiceRecorder {
  private snapshot: RecorderSnapshot = IDLE;
  private listeners = new Set<() => void>();
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  getServerSnapshot = () => IDLE;

  private set(next: RecorderSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private elapsed() {
    return Math.min(MAX_VOICE_NOTE_SECONDS, Math.floor((performance.now() - this.startedAt) / 1000));
  }

  /** Asks for the microphone and starts recording; `onRecorded` receives the finished note. */
  async start(onRecorded: (note: RecordedVoiceNote) => void) {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.set({ status: "unsupported", elapsedSeconds: 0 });
      return;
    }
    this.set({ status: "requesting", elapsedSeconds: 0 });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      this.set({ status: error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "failed", elapsedSeconds: 0 });
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(this.stream, { mimeType: mimeType || undefined, audioBitsPerSecond: VOICE_NOTE_BITS_PER_SECOND });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const seconds = Math.max(1, this.elapsed());
      this.release();
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      this.set(IDLE);
      if (blob.size > 0) onRecorded({ blob, url: URL.createObjectURL(blob), seconds, mimeType: type });
    };
    this.recorder = recorder;
    this.startedAt = performance.now();
    recorder.start(1000);
    this.set({ status: "recording", elapsedSeconds: 0 });
    this.ticker = setInterval(() => {
      const elapsedSeconds = this.elapsed();
      if (elapsedSeconds >= MAX_VOICE_NOTE_SECONDS) this.stop();
      else if (elapsedSeconds !== this.snapshot.elapsedSeconds) this.set({ status: "recording", elapsedSeconds });
    }, 250);
  }

  /** Finishes the recording; the note arrives through `start`'s callback. */
  stop() {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  private release() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
  }

  /** Stops everything without producing a note. */
  dispose = () => {
    if (this.recorder) this.recorder.onstop = null;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.release();
    this.snapshot = IDLE;
  };
}

/** One recorder per mounted voice note field, and its live state. */
export function useVoiceRecorder() {
  const [recorder] = useState(() => new VoiceRecorder());
  const snapshot = useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getServerSnapshot);
  return { recorder, snapshot };
}

/** `m:ss`. */
export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
