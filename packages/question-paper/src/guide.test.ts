import { describe, expect, it } from 'vitest';

import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from './examples';
import {
  buildLearnPayload,
  QUESTION_PAPER_CHAT_TEMPLATE_RULES,
  QUESTION_PAPER_FRAGMENT_RULES,
  QUESTION_PAPER_GUIDE,
  QUESTION_PAPER_TEMPLATE_PRINTS_RULES,
  QUESTION_PAPER_TEMPLATE_PRINTS_UNKNOWN_RULE,
} from './guide';
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

  it("has the agent read what the school's template prints before writing, and compare instead of assuming a list", () => {
    expect(QUESTION_PAPER_GUIDE).toContain('1. Call getQuestionPaper for the paper, also for a new paper that has no version yet: it returns templatePrints');
    expect(QUESTION_PAPER_GUIDE).toContain(QUESTION_PAPER_CHAT_TEMPLATE_RULES);
    expect(QUESTION_PAPER_CHAT_TEMPLATE_RULES).toContain(QUESTION_PAPER_TEMPLATE_PRINTS_RULES);
    expect(QUESTION_PAPER_CHAT_TEMPLATE_RULES).toContain(QUESTION_PAPER_TEMPLATE_PRINTS_UNKNOWN_RULE);
    expect(QUESTION_PAPER_CHAT_TEMPLATE_RULES).toContain('tell the user about the difference');
    // The fragment rules (shared with the job) point at the lines and name no fixed list of what a template prints.
    expect(QUESTION_PAPER_FRAGMENT_RULES).toContain("Which lines it prints for this paper is told to you");
    expect(QUESTION_PAPER_FRAGMENT_RULES).not.toContain('time allowed, maximum marks) and the footer');
    // The job has no tools: the tool names stay out of the shared rule.
    expect(QUESTION_PAPER_TEMPLATE_PRINTS_RULES).not.toContain('getQuestionPaper');
    expect(QUESTION_PAPER_FRAGMENT_RULES).not.toContain('getQuestionPaper');
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
