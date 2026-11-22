import { describe, expect, it } from 'vitest';

import { extractQuestionPaperFragment } from './fragment';
import {
  EMPTY_QUESTION_PAPER_DETAILS,
  normalizeQuestionPaperDetail,
  normalizeQuestionPaperDetails,
  QUESTION_PAPER_DETAIL_MAX_CHARS,
  splitQuestionPaperDetails,
} from './details';

describe('normalizeQuestionPaperDetail', () => {
  it('collapses whitespace, drops control characters and trims', () => {
    expect(normalizeQuestionPaperDetail('  Class\n  5 \u0007 ')).toBe('Class 5');
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
    expect(split.details).toEqual({ schoolName: 'Sunrise School', className: 'Class 3', subjectName: 'Maths', examName: 'Half yearly' });
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
