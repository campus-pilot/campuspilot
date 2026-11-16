/**
 * What the assistant is doing in voice mode, as the one thing its avatar and
 * its label show. Exactly one at a time (the app decides which, see
 * `voiceActivityOf` in the management app's `voice-state.ts`).
 */
export type AssistantVoiceActivity = 'starting' | 'reconnecting' | 'muted' | 'hearing' | 'speaking' | 'working' | 'listening';

/** The label of each activity, as the voice bar says it. Never by colour or motion alone. */
export const ASSISTANT_VOICE_ACTIVITY_LABEL: Record<AssistantVoiceActivity, string> = {
  starting: 'Starting voice',
  reconnecting: 'Reconnecting',
  muted: 'Muted',
  hearing: 'Listening',
  speaking: 'Speaking',
  working: 'Working on it',
  listening: 'Listening',
};

/** What the voice bar says where the user's words go, before they have said anything in this state. */
export const ASSISTANT_VOICE_HINT: Record<AssistantVoiceActivity, string> = {
  starting: 'Starting voice…',
  reconnecting: 'Reconnecting. Your request keeps running.',
  muted: 'The microphone is off. Nothing is being sent.',
  hearing: 'Listening…',
  speaking: 'Just say what you need',
  working: 'Just say what you need',
  listening: 'Just say what you need',
};

/**
 * The line under the voice bar's label: the user's own words while they speak
 * and after, so a misheard name is seen before anything runs; otherwise the
 * hint of the current activity. A closed microphone and a broken link always
 * win, because the old words would suggest the assistant still hears.
 */
export function voiceBarLine(input: { activity: AssistantVoiceActivity; heard: string; heardFinal: boolean }): { text: string; own: boolean } {
  const { activity, heard, heardFinal } = input;
  if (activity === 'muted' || activity === 'starting' || activity === 'reconnecting' || !heard.trim()) {
    return { text: ASSISTANT_VOICE_HINT[activity], own: false };
  }
  return { text: heardFinal ? `You said: ${heard.trim()}` : heard.trim(), own: !heardFinal };
}

/**
 * What stands beside the avatar: the assistant's own words while it speaks,
 * and otherwise one sentence that fits what it is doing. Its last words stay
 * only while it is simply listening again; during anything else they would
 * contradict the avatar (it does not "listen" while it works or is muted).
 */
export function voiceHeaderLine(input: { activity: AssistantVoiceActivity; said: string }): string {
  const said = input.said.trim();
  switch (input.activity) {
    case 'speaking':
      return said || 'One moment.';
    case 'working':
      return 'Looking into it. It will be on your screen in a moment.';
    case 'hearing':
      return 'I’m listening.';
    case 'muted':
      return 'I can’t hear you while the microphone is off.';
    case 'starting':
      return 'One moment, starting voice.';
    case 'reconnecting':
      return 'One moment, reconnecting.';
    case 'listening':
      return said || 'What do you need?';
  }
}

/** How quickly the avatar follows a level: rises fast, falls slowly, like a meter, so speech does not flicker. */
export function smoothedLevel(previous: number, next: number): number {
  const rate = next > previous ? 0.5 : 0.12;
  return previous + (next - previous) * rate;
}
