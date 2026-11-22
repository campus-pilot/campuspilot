import { describe, expect, it } from 'vitest';

import { extractQuestionPaperFragment } from './fragment';
import {
  EMPTY_QUESTION_PAPER_DETAILS,
  normalizeQuestionPaperDetail,
  normalizeQuestionPaperDetails,
  normalizeQuestionPaperMaxMarks,
  QUESTION_PAPER_DETAIL_MAX_CHARS,
  QUESTION_PAPER_DETAIL_MAX_MARKS,
  splitQuestionPaperDetails,
} from './details';

describe('normalizeQuestionPaperDetail', () => {
  it('collapses whitespace, drops control characters and trims', () => {
    expect(normalizeQuestionPaperDetail('  Class\n  5 \u0007 ')).toBe('Class 5');
  });
  it('removes angle brackets, so a name never carries markup into a template', () => {
    expect(normalizeQuestionPaperDetail('<div class="qp-body" id="qp-body-slot"></div>Class 5')).toBe('div class="qp-body" id="qp-body-slot"/divClass 5');
    expect(normalizeQuestionPaperDetail('<>')).toBeNull();
  });
  it('treats empty and non-string values as not stated', () => {
    expect(normalizeQuestionPaperDetail('   ')).toBeNull();
    expect(normalizeQuestionPaperDetail(5)).toBeNull();
    expect(normalizeQuestionPaperDetail(null)).toBeNull();
  });
  it('cuts by code point at the cap', () => {
    const long = '𝔸'.repeat(QUESTION_PAPER_DETAIL_MAX_CHARS + 10);
    const cut = normalizeQuestionPaperDetail(long)!;
    expect(Array.from(cut)).toHaveLength(QUESTION_PAPER_DETAIL_MAX_CHARS);
  });
});

describe('normalizeQuestionPaperMaxMarks', () => {
  it('keeps a whole number in bounds, given as a number or as text that is only that number', () => {
    expect(normalizeQuestionPaperMaxMarks(80)).toBe(80);
    expect(normalizeQuestionPaperMaxMarks(' 80 ')).toBe(80);
    expect(normalizeQuestionPaperMaxMarks(QUESTION_PAPER_DETAIL_MAX_MARKS)).toBe(QUESTION_PAPER_DETAIL_MAX_MARKS);
  });
  it('treats anything else as not stated, never refusing', () => {
    for (const value of [0, -5, 2.5, QUESTION_PAPER_DETAIL_MAX_MARKS + 1, '80 marks', '2.5', '', null, undefined, Number.NaN, '1e3']) {
      expect(normalizeQuestionPaperMaxMarks(value)).toBeNull();
    }
  });
});

describe('normalizeQuestionPaperDetails', () => {
  it('ignores unknown keys and non-objects', () => {
    expect(normalizeQuestionPaperDetails({ schoolName: 'St. Mary', extra: 'x' })).toEqual({ ...EMPTY_QUESTION_PAPER_DETAILS, schoolName: 'St. Mary' });
    expect(normalizeQuestionPaperDetails([1, 2])).toEqual(EMPTY_QUESTION_PAPER_DETAILS);
  });
});

describe('splitQuestionPaperDetails', () => {
  const html = '<h1>Half yearly</h1><p>Q1. Add 2 and 3.</p>';
  it('reads the details block and removes it from the answer', () => {
    const answer = `${html}\n\n\`\`\`paper-details\n{"schoolName":"Sunrise School","className":"Class 3","subjectName":"Maths","examName":"Half yearly"}\n\`\`\``;
    const split = splitQuestionPaperDetails(answer);
    expect(split.details).toEqual({ schoolName: 'Sunrise School', className: 'Class 3', subjectName: 'Maths', examName: 'Half yearly', maxMarks: null });
    expect(extractQuestionPaperFragment(split.text)).toBe(html);
  });
  it('keeps a fenced html block as the fragment', () => {
    const answer = `\`\`\`html\n${html}\n\`\`\`\n\`\`\`paper-details\n{"className":"5"}\n\`\`\``;
    const split = splitQuestionPaperDetails(answer);
    expect(split.details.className).toBe('5');
    expect(extractQuestionPaperFragment(split.text)).toBe(html);
  });
  it('gives no details for a malformed or missing block', () => {
    expect(splitQuestionPaperDetails(`${html}\n\`\`\`paper-details\n{not json\n\`\`\``).details).toEqual(EMPTY_QUESTION_PAPER_DETAILS);
    expect(splitQuestionPaperDetails(html)).toEqual({ text: html, details: EMPTY_QUESTION_PAPER_DETAILS, found: false });
  });
});
