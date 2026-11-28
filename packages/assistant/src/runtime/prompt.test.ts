import { describe, expect, it } from 'vitest';

import { buildAssistantPrompt, buildFactsText, istInstant } from './prompt';
import { unavailableSchoolWork } from './unavailable-work';
import { sentAtText } from '../transcript';

describe('run facts', () => {
  it('writes the run start as India time with its offset, on India’s date', () => {
    // 23:25 UTC is already the next day in India.
    expect(istInstant(new Date('2026-11-11T23:25:12.345Z'))).toBe('2026-11-12T04:55:12+05:30');
    expect(new Date(istInstant(new Date('2026-11-11T23:25:12Z'))).toISOString()).toBe('2026-11-11T23:25:12.000Z');
  });

  it('keeps the date and time out of the system prompt, so it is the same for every message of a conversation', () => {
    // Production cost rows showed every new message missing the prompt cache while the run's start time was in it.
    const facts = { schoolId: 's', schoolName: 'Maple', userName: 'U', userEmail: 'u@x' };
    const prompt = buildAssistantPrompt(facts);
    expect(prompt.facts).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prompt.instructions).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(buildAssistantPrompt(facts))).toBe(JSON.stringify(prompt));
    // The model is told where the time is instead.
    expect(prompt.instructions).toContain('Each user message ends with a line the app adds');
  });

  it('dates each message with a line of its own, on India’s date', () => {
    const line = sentAtText(istInstant(new Date('2026-11-11T23:25:12Z')));
    expect(line).toBe("[Sent 2026-11-12T04:55:12+05:30 (India time). Today's date is 2026-11-12. This line is added by the app.]");
  });

  it('names a phone-only user without an address (their stored email is a placeholder)', () => {
    const facts = {
      schoolId: 's',
      schoolName: 'Maple',
      userName: 'Asha',
      userEmail: null,
    };
    expect(buildFactsText(facts)).toContain('Signed-in user: Asha.\n');
    expect(buildFactsText({ ...facts, userEmail: 'asha@school.test' })).toContain('Signed-in user: Asha <asha@school.test>.');
  });
});

describe('parts of CampusPilot the school does not have', () => {
  const base = {
    schoolId: 's',
    schoolName: 'Maple',
    userName: 'U',
    userEmail: 'u@x',
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
  }).instructions;

  it('does not decline a paper written from a description', () => {
    expect(instructions).not.toContain('question papers written from scratch');
    expect(instructions).toContain('write one yourself from the user\'s description, with no photograph');
  });
});
