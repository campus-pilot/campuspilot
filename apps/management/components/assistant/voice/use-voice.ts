'use client';

import { useSyncExternalStore } from 'react';

import { voice } from './voice-controller';
import { VOICE_OFF, type VoiceState } from './voice-state';

/** On the server there is never a session. */
const serverSnapshot = (): VoiceState => VOICE_OFF;

/** The app's voice session as React state (`voice-controller.ts`). Acting on it is done through `voice`, from event handlers. */
export function useVoice(): VoiceState {
  return useSyncExternalStore(voice.subscribe, voice.getSnapshot, serverSnapshot);
}
