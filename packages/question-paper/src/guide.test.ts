import { describe, expect, it } from 'vitest';

import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from './examples';
import { buildLearnPayload, QUESTION_PAPER_FRAGMENT_RULES, QUESTION_PAPER_GUIDE } from './guide';
import { QUESTION_PAPER_LIMITS } from './limits';

describe('the learn guide', () => {
  it('states the no-animation rule first and names what is forbidden', () => {
    expect(QUESTION_PAPER_FRAGMENT_RULES.startsWith('## NO ANIMATION, NO MOTION')).toBe(true);
    for (const word of ['<animate>', '<animateTransform>', '<animateMotion>', '<set>', 'animation', 'transition', '@keyframes', 'will-change']) {
      expect(QUESTION_PAPER_GUIDE).toContain(word);
    }
  });

  it('documents data-math, data-display, figures, placeholders and languages', () => {
    for (const phrase of ['data-math', 'data-display', 'data-figure-id', 'data-placeholder', 'lang=', 'dir="rtl"', 'asat_']) {
      expect(QUESTION_PAPER_GUIDE).toContain(phrase);
    }
  });

  it('names both ways to read a paper back for editing: a saved paper and an unsaved draft', () => {
    expect(QUESTION_PAPER_GUIDE).toContain('getQuestionPaperDraft with a draftId');
    expect(QUESTION_PAPER_GUIDE).toContain('never send it as html');
  });

  it('says an attached PDF is source material to read, never a figure to print', () => {
    expect(QUESTION_PAPER_GUIDE).toContain('An attached PDF');
    expect(QUESTION_PAPER_GUIDE).toContain('SOURCE MATERIAL to read');
    expect(QUESTION_PAPER_GUIDE).toContain('its id can never be a data-figure-id');
    // The job prompt shares only the fragment rules; attachments exist in chat only.
    expect(QUESTION_PAPER_FRAGMENT_RULES).not.toContain('attached PDF');
  });

  it('returns the guide, the limits and one worked example', () => {
    const payload = buildLearnPayload();
    expect(payload.guide).toBe(QUESTION_PAPER_GUIDE);
    expect(payload.limits).toBe(QUESTION_PAPER_LIMITS);
    expect(payload.example).toBe(EXAMPLE_HINDI_MATH_HTML);
    expect(payload.example).toContain('data-math');
  });

  it('has examples that carry no motion', () => {
    for (const html of [EXAMPLE_HINDI_MATH_HTML, EXAMPLE_ENGLISH_SCIENCE_HTML]) {
      expect(html).not.toMatch(/animat|transition|keyframes|<script|url\(/i);
    }
  });
});
