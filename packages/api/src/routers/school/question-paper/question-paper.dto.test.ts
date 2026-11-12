import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import { describe, expect, it } from 'vitest';

import { QUESTION_PAPER_LEARN_OUTPUT_CHARS, QUESTION_PAPER_PAPER_OUTPUT_CHARS, QUESTION_PAPER_VALIDATE_LINE_CHARS, QUESTION_PAPER_VALIDATE_LISTED, QUESTION_PAPER_VALIDATE_OUTPUT_CHARS } from './question-paper.dto';
import { leanLines } from './question-paper.lean';

describe('the assistant output caps of the question paper tools', () => {
  it('let getQuestionPaper return the longest allowed fragment, with every quote and line end escaped, and still the rest of the result', () => {
    const worstOrdinary = QUESTION_PAPER_LIMITS.fragmentChars * 2;
    expect(QUESTION_PAPER_PAPER_OUTPUT_CHARS).toBeGreaterThan(worstOrdinary);
    // Not a hard-coded number: it follows the fragment limit.
    expect(QUESTION_PAPER_PAPER_OUTPUT_CHARS - worstOrdinary).toBeGreaterThanOrEqual(40_000);
  });

  it('keep validate lean: its cap does not depend on the fragment, and its listed lines always fit', () => {
    const worstLines = 2 * (QUESTION_PAPER_VALIDATE_LISTED + 1) * QUESTION_PAPER_VALIDATE_LINE_CHARS;
    expect(QUESTION_PAPER_VALIDATE_OUTPUT_CHARS).toBeGreaterThan(worstLines);
    expect(QUESTION_PAPER_VALIDATE_OUTPUT_CHARS).toBeLessThan(QUESTION_PAPER_LIMITS.fragmentChars);
  });

  it('leave the learn payload (guide, limits, one example) room', () => {
    expect(QUESTION_PAPER_LEARN_OUTPUT_CHARS).toBeGreaterThan(20_000);
  });
});

describe('leanLines', () => {
  it('lists the first lines, cuts long ones and counts the rest', () => {
    const many = Array.from({ length: QUESTION_PAPER_VALIDATE_LISTED + 5 }, (_, index) => `problem ${index}`);
    const lean = leanLines(many);
    expect(lean).toHaveLength(QUESTION_PAPER_VALIDATE_LISTED + 1);
    expect(lean.at(-1)).toBe('and 5 more');
    expect(leanLines(['x'.repeat(QUESTION_PAPER_VALIDATE_LINE_CHARS + 50)])[0]).toHaveLength(QUESTION_PAPER_VALIDATE_LINE_CHARS);
    expect(leanLines(['a', 'b'])).toEqual(['a', 'b']);
  });
});
