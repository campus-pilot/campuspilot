import { QUESTION_PAPER_GUIDE } from '@campuspilot/question-paper/guide';
import { describe, expect, it } from 'vitest';

import { QUESTION_PAPER_JOB_SYSTEM_PROMPT } from './prompt';

describe('the generation job prompt and the chat guide tell one story (m2)', () => {
  it('both start with the no-animation rule', () => {
    expect(QUESTION_PAPER_JOB_SYSTEM_PROMPT.startsWith('## NO ANIMATION, NO MOTION')).toBe(true);
    expect(QUESTION_PAPER_GUIDE.split('\n').slice(0, 4).join('\n')).toContain('NO ANIMATION, NO MOTION');
  });

  it('the job prompt has no chat-only attachment instructions and says plainly that figures are placeholders', () => {
    expect(QUESTION_PAPER_JOB_SYSTEM_PROMPT).not.toContain('asat_');
    expect(QUESTION_PAPER_JOB_SYSTEM_PROMPT).not.toContain('Attached images (chat)');
    expect(QUESTION_PAPER_JOB_SYSTEM_PROMPT).toContain('no image can be attached');
    expect(QUESTION_PAPER_JOB_SYSTEM_PROMPT).toContain('data-placeholder');
    expect(QUESTION_PAPER_GUIDE).toContain('asat_');
  });

  it.each([QUESTION_PAPER_JOB_SYSTEM_PROMPT, QUESTION_PAPER_GUIDE])('tells the model what the sanitiser really removes', (text) => {
    for (const phrase of ['viewBox', 'padding', '&quot;', '\\textquotedblleft', 'qp', '.qp-body', '@media', '@page', 'pre, code', 'calc()', 'removed and reported as a notice', 'No <style> inside an svg']) {
      expect(text, phrase).toContain(phrase);
    }
    expect(text).not.toContain('removed and reported as a problem');
    expect(text).not.toContain('keep quotes out');
  });
});
