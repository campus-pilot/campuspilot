import { describe, expect, it } from 'vitest';

import { GENERIC_PROBLEM_SENTENCE, summarizeProblems } from './paper-problems-model';

describe('summarizeProblems', () => {
  it('turns formula failures into one sentence without LaTeX or KaTeX text, keeping the raw lines for Details', () => {
    const lines = [
      "Formula 2 (\\frac{1}{2): KaTeX parse error: Expected 'EOF', got '}' at position 12",
      'Formula 5 (x^): Invalid TeX',
      'Formula 2 (\\frac{1}{2): again',
    ];
    const { sentences, details } = summarizeProblems(lines);
    expect(sentences).toEqual(['Formulas 2 and 5 could not be typeset.']);
    expect(details).toEqual(lines);
    expect(summarizeProblems([lines[1]!]).sentences).toEqual(['Formula 5 could not be typeset.']);
    expect(summarizeProblems(['Formula 1 (a): x', 'Formula 2 (b): y', 'Formula 3 (c): z']).sentences).toEqual([
      'Formulas 1, 2 and 3 could not be typeset.',
    ]);
  });

  it('maps the limits and figure problems the API reports to plain sentences, once each', () => {
    const { sentences } = summarizeProblems([
      'The paper is empty. Write the questions as HTML.',
      'The paper is 91,000 characters after cleaning; the limit is 80,000. Make it shorter.',
      'The paper has 12 SVG drawings; the limit is 10.',
      'A formula is 700 characters; the limit is 500. Split it.',
      'Figure asat_abcdefghijklmnopqrstu: This figure image does not belong to this paper.',
      'Figure qpf_abcdefghijklmnopqrstu: gone',
      'The formulas of this paper are too large to print. Shorten or remove some formulas.',
    ]);
    expect(sentences).toEqual([
      'The paper has no questions yet.',
      'The paper is too long to save.',
      'The paper has too many drawings.',
      'One formula is too long.',
      'A figure image could not be used.',
      'The formulas are too large to print.',
    ]);
  });

  it('falls back to the generic sentence for a line it does not know, without showing the line', () => {
    const { sentences, details } = summarizeProblems(['A brand new kind of problem nobody mapped', 'Another unknown']);
    expect(sentences).toEqual([GENERIC_PROBLEM_SENTENCE]);
    expect(details).toHaveLength(2);
    expect(summarizeProblems([]).sentences).toEqual([]);
  });
});
