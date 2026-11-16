import { describe, expect, it } from 'vitest';

import { buildAssistantPrompt, buildFactsText, istInstant } from './prompt';
import { unavailableSchoolWork } from './unavailable-work';

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

describe('parts of CampusPilot the school does not have', () => {
  const base = {
    schoolId: 's',
    schoolName: 'Maple',
    userName: 'U',
    userEmail: 'u@x',
    today: '2026-11-12',
    now: '2026-11-12T04:55:12+05:30',
  };

  it('lists the unavailable work it is given and says how to answer for it', () => {
    const text = buildFactsText(base, ['student management: admissions and fees', 'school notices']);
    expect(text).toContain('This school does not use these parts of CampusPilot, so you have no tools for them: student management: admissions and fees; school notices.');
    expect(text).toContain('say in one sentence that this school does not use that part of CampusPilot');
  });

  it('says nothing about it when no tool was withheld', () => {
    expect(buildFactsText(base, [])).not.toContain('does not use');
    // The stored facts of a run carry no such list (a run begun before this existed has none), so the default is "nothing withheld".
    expect(buildFactsText(base)).not.toContain('does not use');
    expect(buildAssistantPrompt(base).facts).not.toContain('does not use');
  });
});

describe('what a missing feature is called', () => {
  it('names only features that took a tool away', () => {
    expect(unavailableSchoolWork(new Set())).toEqual([]);
    const cadet = unavailableSchoolWork(new Set(['cadet']));
    expect(cadet).toHaveLength(1);
    expect(cadet[0]).toContain('Cadet Portal');
  });

  it('does not tell the model that fees or results are gone when only the Cadet Portal is', () => {
    const [cadet] = unavailableSchoolWork(new Set(['cadet']));
    // What is unavailable: portal passwords and releasing results to the portal.
    expect(cadet).toContain('issuing portal passwords');
    // What stays is said to stay.
    expect(cadet).toContain("Staff's work with fees, results and student records is not part of it");
  });

  it('covers a feature that requires a withheld one by that one\'s line', () => {
    const lines = unavailableSchoolWork(new Set(['studentManagement', 'cadet', 'notices']));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('student management: admissions');
  });

  it('ignores keys that are not catalogue features', () => {
    expect(unavailableSchoolWork(new Set(['retired']))).toEqual([]);
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
