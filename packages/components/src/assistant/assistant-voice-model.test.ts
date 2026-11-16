import { describe, expect, it } from 'vitest';

import { ASSISTANT_VOICE_ACTIVITY_LABEL, smoothedLevel, voiceBarLine, voiceHeaderLine, type AssistantVoiceActivity } from './assistant-voice-model';

const ACTIVITIES = Object.keys(ASSISTANT_VOICE_ACTIVITY_LABEL) as AssistantVoiceActivity[];

describe('voiceBarLine', () => {
  it('shows the user’s words as they speak, then marks them as said', () => {
    expect(voiceBarLine({ activity: 'hearing', heard: ' Class 8-B ki ', heardFinal: false })).toEqual({ text: 'Class 8-B ki', own: true });
    expect(voiceBarLine({ activity: 'working', heard: 'Class 8-B ki report', heardFinal: true })).toEqual({ text: 'You said: Class 8-B ki report', own: false });
  });

  it('says what to do before anything was said', () => {
    expect(voiceBarLine({ activity: 'listening', heard: '', heardFinal: false })).toEqual({ text: 'Just say what you need', own: false });
    expect(voiceBarLine({ activity: 'hearing', heard: '  ', heardFinal: false }).text).toBe('Listening…');
  });

  it('never leaves old words up while the assistant cannot hear: muted, starting, reconnecting', () => {
    for (const activity of ['muted', 'starting', 'reconnecting'] as const) {
      const line = voiceBarLine({ activity, heard: 'Class 8-B ki report', heardFinal: true });
      expect(line.own).toBe(false);
      expect(line.text).not.toContain('Class 8-B');
    }
    expect(voiceBarLine({ activity: 'muted', heard: 'x', heardFinal: true }).text).toBe('The microphone is off. Nothing is being sent.');
  });
});

describe('voiceHeaderLine', () => {
  it('shows the assistant’s words while it speaks and while it is simply listening again', () => {
    expect(voiceHeaderLine({ activity: 'speaking', said: 'There are 11 students.' })).toBe('There are 11 students.');
    expect(voiceHeaderLine({ activity: 'listening', said: 'There are 11 students.' })).toBe('There are 11 students.');
    expect(voiceHeaderLine({ activity: 'listening', said: '' })).toBe('What do you need?');
  });

  it('never claims to listen while it works or is muted, whatever it said last', () => {
    const said = 'Go ahead, I’m listening.';
    expect(voiceHeaderLine({ activity: 'working', said })).toBe('Looking into it. It will be on your screen in a moment.');
    expect(voiceHeaderLine({ activity: 'muted', said })).toBe('I can’t hear you while the microphone is off.');
    expect(voiceHeaderLine({ activity: 'reconnecting', said })).toBe('One moment, reconnecting.');
  });

  it('has a sentence for every activity', () => {
    for (const activity of ACTIVITIES) expect(voiceHeaderLine({ activity, said: '' }).length).toBeGreaterThan(0);
  });
});

describe('smoothedLevel', () => {
  it('rises fast and falls slowly, so speech does not flicker', () => {
    const up = smoothedLevel(0, 1);
    const down = smoothedLevel(1, 0);
    expect(up).toBe(0.5);
    expect(down).toBeCloseTo(0.88);
    expect(1 - down).toBeLessThan(up);
  });

  it('settles on a steady level', () => {
    let level = 0;
    for (let frame = 0; frame < 60; frame += 1) level = smoothedLevel(level, 0.4);
    expect(level).toBeCloseTo(0.4, 5);
  });
});
