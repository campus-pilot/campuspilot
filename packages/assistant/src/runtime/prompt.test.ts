import { describe, expect, it } from 'vitest';

import { buildAssistantPrompt, buildFactsText, istInstant } from './prompt';

describe('run facts', () => {
  it('writes the run start as India time with its offset, on India’s date', () => {
    // 23:25 UTC is already the next day in India.
    expect(istInstant(new Date('2026-11-11T23:25:12.345Z'))).toBe('2026-11-12T04:55:12+05:30');
    expect(new Date(istInstant(new Date('2026-11-11T23:25:12Z'))).toISOString()).toBe('2026-11-11T23:25:12.000Z');
  });

  it('gives the model the date and the current time', () => {
    const text = buildFactsText({
      schoolId: 's',
      schoolName: 'Maple',
      userName: 'U',
      userEmail: 'u@x',
      today: '2026-11-12',
      now: '2026-11-12T04:55:12+05:30',
    });
    expect(text).toContain("Today's date: 2026-11-12. Current time: 2026-11-12T04:55:12+05:30 (India time, when this request began).");
  });
});

describe('question papers', () => {
  const instructions = buildAssistantPrompt({
    schoolId: 's',
    schoolName: 'Maple',
    userName: 'U',
    userEmail: 'u@x',
    today: '2026-11-12',
    now: '2026-11-12T04:55:12+05:30',
  }).instructions;

  it('does not decline a paper written from a description', () => {
    expect(instructions).not.toContain('question papers written from scratch');
    expect(instructions).toContain('write one yourself from the user\'s description, with no photograph');
  });
});
