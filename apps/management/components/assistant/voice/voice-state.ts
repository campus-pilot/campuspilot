import type { VoiceEndReason, VoiceServerMessage } from '@campuspilot/assistant-contract/voice';
import type { AssistantVoiceActivity } from '@campuspilot/components/assistant';

/**
 * Voice mode's state in the browser, as plain data and pure rules, so what the
 * screen shows is decided here and tested without a microphone or a socket.
 * `voice-controller.ts` feeds it; the React components only read it.
 */

/**
 * Where a session stands:
 * - `off`: no session.
 * - `asking`: waiting for the browser's microphone permission.
 * - `connecting`: the microphone is open, the server is being reached.
 * - `live`: talking.
 * - `reconnecting`: the server is restoring its link to the voice model.
 */
export type VoicePhase = 'off' | 'asking' | 'connecting' | 'live' | 'reconnecting';

/** Why voice is not on, said to the user in the voice bar's place until they act. */
export type VoiceNotice = { tone: 'info' | 'problem'; message: string };

export type VoiceState = {
  phase: VoicePhase;
  /** The chat that started the session; only it shows the voice screen. */
  ownerId: string | null;
  /** The user closed the microphone: nothing is sent while it is closed. */
  muted: boolean;
  /** The voice model hears the user speaking. */
  userSpeaking: boolean;
  /** The assistant's voice is playing. */
  assistantSpeaking: boolean;
  /** How many spoken requests are with the assistant now. */
  working: number;
  /** What the user said last, and whether that utterance is complete. */
  heard: string;
  heardFinal: boolean;
  /** What the assistant is saying, or said last. */
  said: string;
  notice: VoiceNotice | null;
};

export const VOICE_OFF: VoiceState = {
  phase: 'off',
  ownerId: null,
  muted: false,
  userSpeaking: false,
  assistantSpeaking: false,
  working: 0,
  heard: '',
  heardFinal: false,
  said: '',
  notice: null,
};

/**
 * What the assistant is doing (`AssistantVoiceActivity`), in this order of
 * precedence: a session that is not live yet, then a closed microphone (the
 * user must never think they are heard when they are not), then who is
 * speaking, then work in progress.
 */
export function voiceActivityOf(state: VoiceState): AssistantVoiceActivity {
  if (state.phase === 'asking' || state.phase === 'connecting') return 'starting';
  if (state.phase === 'reconnecting') return 'reconnecting';
  if (state.muted) return 'muted';
  if (state.userSpeaking) return 'hearing';
  if (state.assistantSpeaking) return 'speaking';
  if (state.working > 0) return 'working';
  return 'listening';
}

/** Whether a session exists (from the permission prompt until it ends). */
export const voiceIsOn = (state: VoiceState): boolean => state.phase !== 'off';

/** The state after a message from the server. Audio and requests are handled by the controller, not here. */
export function voiceStateAfter(state: VoiceState, message: VoiceServerMessage): VoiceState {
  switch (message.type) {
    case 'ready':
    case 'reconnected':
      return { ...state, phase: 'live' };
    case 'reconnecting':
      return { ...state, phase: 'reconnecting', userSpeaking: false };
    case 'user_speaking':
      // A new utterance replaces the caption of the last one.
      return { ...state, userSpeaking: message.speaking, ...(message.speaking ? { heard: '', heardFinal: false } : {}) };
    case 'heard':
      return { ...state, heard: message.text, heardFinal: message.final };
    case 'said':
      return { ...state, said: message.text };
    case 'ask':
      return { ...state, working: state.working + 1 };
    case 'ask_done':
      return { ...state, working: Math.max(0, state.working - 1) };
    case 'open':
    case 'open_link':
    case 'read_screen':
    case 'reply_done':
    case 'interrupted':
    case 'ended':
      return state;
  }
}

/**
 * The reasons a session ends without anything having gone wrong: it was quiet,
 * it reached its length, the user took it to another window, or the server is
 * being updated. Said as information; every other reason is a problem.
 */
const ORDINARY_ENDS: ReadonlySet<VoiceEndReason> = new Set(['idle', 'max_duration', 'replaced', 'restarting']);

/**
 * What the user is told when a session ends on its own; null when they ended
 * it themselves (`ended`). Decided by the reason alone: the message is the
 * server's wording for the user and may change without changing what happened.
 */
export function noticeOfEnd(reason: VoiceEndReason, message: string): VoiceNotice | null {
  if (reason === 'ended') return null;
  return { tone: ORDINARY_ENDS.has(reason) ? 'info' : 'problem', message };
}

/** Why the microphone could not be opened, in the user's words. */
export function noticeOfMicError(error: unknown): VoiceNotice {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { tone: 'problem', message: 'The browser is not allowed to use the microphone. Allow it for this site, then start voice again.' };
  }
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
    return { tone: 'problem', message: 'No microphone was found. Connect one, then start voice again.' };
  }
  return { tone: 'problem', message: 'The microphone could not be started. Try again.' };
}
