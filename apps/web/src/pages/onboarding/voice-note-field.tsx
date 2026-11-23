import { MAX_VOICE_NOTE_SECONDS } from "@campuspilot/api/leads/school-onboarding";
import { Mic, Square, Trash2 } from "lucide-react";
import { useCallback } from "react";

import { FieldError, firstError } from "./field-parts";
import type { OnboardingFormApi } from "./onboarding-form";
import { formatDuration, useVoiceRecorder, type RecordedVoiceNote, type RecorderSnapshot } from "./voice-recorder";

const LIMIT = formatDuration(MAX_VOICE_NOTE_SECONDS);

/** Why recording is not possible right now, in words, or null. */
function recorderProblem(snapshot: RecorderSnapshot) {
  if (snapshot.status === "denied") return "Microphone access was blocked. Allow it in your browser's site settings, then try again.";
  if (snapshot.status === "unsupported") return "This browser cannot record audio. Type your notes instead.";
  if (snapshot.status === "failed") return "No microphone could be used. Check that one is connected, then try again.";
  return null;
}

function Recording({ elapsedSeconds, onStop }: { elapsedSeconds: number; onStop: () => void }) {
  return (
    <div className="ob-recorder" data-state="recording">
      <span className="ob-rec-dot" aria-hidden="true" />
      <span className="ob-rec-time" role="timer" aria-live="off">
        {formatDuration(elapsedSeconds)} <small>/ {LIMIT}</small>
      </span>
      <progress className="ob-rec-progress" max={MAX_VOICE_NOTE_SECONDS} value={elapsedSeconds} aria-label="Recording length" />
      <button type="button" className="cp-btn cp-btn-light cp-btn-sm" onClick={onStop}>
        <Square aria-hidden="true" /> Stop
      </button>
    </div>
  );
}

function Recorded({ note, onDiscard }: { note: RecordedVoiceNote; onDiscard: () => void }) {
  return (
    <div className="ob-recorder" data-state="recorded">
      <audio controls preload="metadata" src={note.url} aria-label="Your voice note" />
      <span className="ob-rec-time">{formatDuration(note.seconds)}</span>
      <button type="button" className="ob-icon-btn" aria-label="Delete voice note" onClick={onDiscard}>
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}

function Idle({ requesting, onStart }: { requesting: boolean; onStart: () => void }) {
  return (
    <div className="ob-recorder" data-state="idle">
      <button type="button" className="cp-btn cp-btn-light" disabled={requesting} onClick={onStart}>
        <Mic aria-hidden="true" /> {requesting ? "Allow the microphone…" : "Record a voice note"}
      </button>
      <small>Up to {MAX_VOICE_NOTE_SECONDS / 60} minutes. Speak in any language.</small>
    </div>
  );
}

/**
 * Records a voice note in the page. The finished recording is the form's
 * `voiceNote` value (with an object URL for playback, revoked on delete);
 * the recorder itself lives outside the form (`voice-recorder.ts`) and is
 * disposed when this field unmounts, through the ref callback's cleanup.
 */
function VoiceNoteControl({ value, onChange, error }: { value: RecordedVoiceNote | null; onChange: (next: RecordedVoiceNote | null) => void; error: string | null }) {
  const { recorder, snapshot } = useVoiceRecorder();
  const disposeOnUnmount = useCallback(() => recorder.dispose, [recorder]);
  const discard = () => {
    if (value) URL.revokeObjectURL(value.url);
    onChange(null);
  };
  return (
    <div ref={disposeOnUnmount} className="pg-book-form-field">
      <span className="pg-book-form-label">
        Voice note <span>Optional</span>
      </span>
      {value ? (
        <Recorded note={value} onDiscard={discard} />
      ) : snapshot.status === "recording" ? (
        <Recording elapsedSeconds={snapshot.elapsedSeconds} onStop={() => recorder.stop()} />
      ) : (
        <Idle requesting={snapshot.status === "requesting"} onStart={() => void recorder.start(onChange)} />
      )}
      <FieldError id="ob-voice-error" message={error ?? recorderProblem(snapshot)} />
    </div>
  );
}

export function VoiceNoteField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="voiceNote">
      {(field) => <VoiceNoteControl value={field.state.value} onChange={field.handleChange} error={firstError(field.state.meta.errors)} />}
    </form.Field>
  );
}
