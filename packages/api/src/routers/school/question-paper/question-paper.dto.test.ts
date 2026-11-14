import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import { describe, expect, it } from 'vitest';

import {
  QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS,
  QUESTION_PAPER_LEARN_OUTPUT_CHARS,
  QUESTION_PAPER_PAPER_OUTPUT_CHARS,
  QUESTION_PAPER_VALIDATE_LINE_CHARS,
  QUESTION_PAPER_VALIDATE_LISTED,
  QUESTION_PAPER_VALIDATE_OUTPUT_CHARS,
  startGenerationInputSchema,
} from './question-paper.dto';
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

describe("startQuestionPaperGeneration's teacher's instructions", () => {
  const key = { schoolId: 's', sessionId: 'se', examSlug: 'term-1', classId: 'c', subjectSlug: 'science', modeSlug: 'theory', expectedPageRevision: 1 };
  const parse = (instructions?: unknown) => startGenerationInputSchema.safeParse(instructions === undefined ? key : { ...key, instructions });
  const accepted = (instructions?: unknown) => {
    const result = parse(instructions);
    if (!result.success) throw new Error(result.error.message);
    return result.data.instructions;
  };
  const refusal = (instructions: unknown) => {
    const result = parse(instructions);
    return result.success ? null : result.error.issues.map((issue) => issue.message);
  };

  it('are optional: leaving them out, or sending only whitespace, is the same as none', () => {
    expect(accepted()).toBeUndefined();
    expect(accepted('')).toBeNull();
    expect(accepted('   \n\t \r\n ')).toBeNull();
  });

  it('are trimmed, with every line break normalised to a line feed; tabs, Indian scripts and joiners are kept', () => {
    expect(accepted('  Make section B easier.  ')).toBe('Make section B easier.');
    expect(accepted('Keep the questions\r\nbut change the numbers\rplease')).toBe('Keep the questions\nbut change the numbers\nplease');
    expect(accepted('Q7:\tleave out')).toBe('Q7:\tleave out');
    // Zero-width joiner and non-joiner are format characters Indian scripts need, not control characters.
    expect(accepted('इसे हिंदी में टाइप करें \u200d\u200c')).toBe('इसे हिंदी में टाइप करें \u200d\u200c');
  });

  it(`hold at most ${QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS} characters, counted after trimming`, () => {
    const longest = 'x'.repeat(QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS);
    expect(accepted(longest)).toBe(longest);
    expect(accepted(`   ${longest}\n\n`)).toBe(longest);
    expect(refusal(`${longest}x`)).toEqual([`Instructions can be at most ${QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS} characters.`]);
  });

  it('refuse (never strip) any other control character, so what is stored is what the teacher sent', () => {
    for (const control of ['\u0000', '\u0007', '\u000b', '\u000c', '\u001b', '\u007f', '\u0085', '\u009f']) {
      expect(refusal(`Leave out${control} question 7`), JSON.stringify(control)).toEqual(['Instructions cannot contain control characters.']);
    }
  });

  it('are text only', () => {
    expect(refusal(42)).not.toBeNull();
    expect(refusal(null)).not.toBeNull();
  });
});
