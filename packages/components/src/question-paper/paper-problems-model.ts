/**
 * What stops a draft from being saved, in sentences a teacher can read.
 *
 * The API's problem lines are written for the model that has to fix the paper
 * (LaTeX source, KaTeX messages, the HTML it wrote), so the chat card never
 * prints them as they are: each known kind is mapped to a plain sentence here,
 * and the raw lines stay available behind a collapsed "Details" list. The
 * mapping matches the start of a line, which is stable text the API writes
 * (`question-paper.sanitize.ts`, `question-paper.version.service.ts`); a line
 * that matches nothing (a new kind, a reworded one) is never lost or shown
 * raw in the main text: it only adds the generic sentence, and its text is
 * in Details.
 */

/** Shown for a problem line this mapping does not know. */
export const GENERIC_PROBLEM_SENTENCE = 'Something in this draft could not be accepted.';

/** Lines about a limit being exceeded, by the start of the API's sentence. */
const KNOWN_PROBLEMS: readonly { test: RegExp; sentence: string }[] = [
  { test: /^The paper is empty/, sentence: 'The paper has no questions yet.' },
  {
    test: /^The paper is [\d,]+ characters after cleaning/,
    sentence: 'The paper is too long to save.',
  },
  {
    test: /^The paper has [\d,]+ elements/,
    sentence: 'The paper is too complicated to save.',
  },
  {
    test: /^The paper has \d+ SVG drawings/,
    sentence: 'The paper has too many drawings.',
  },
  {
    test: /^The SVG drawings have /,
    sentence: 'The drawings are too detailed.',
  },
  {
    test: /^The <style> blocks are /,
    sentence: 'The paper’s styling is too long.',
  },
  {
    test: /^The paper has \d+ formulas;/,
    sentence: 'The paper has too many formulas.',
  },
  {
    test: /^A formula is \d+ characters/,
    sentence: 'One formula is too long.',
  },
  {
    test: /^The paper has \d+ figures and placeholders/,
    sentence: 'The paper has too many figures.',
  },
  {
    test: /^The formulas of this paper are too large to print/,
    sentence: 'The formulas are too large to print.',
  },
  {
    test: /^Figure (?:asat|qpf)_/,
    sentence: 'A figure image could not be used.',
  },
  { test: /^This draft is not valid\.$/, sentence: GENERIC_PROBLEM_SENTENCE },
];

/** "Formula 2 (\frac{1}{: ...): message": only the number is kept. */
const FORMULA_PROBLEM = /^Formula (\d+) \(/;

const joinNumbers = (numbers: readonly number[]) =>
  numbers.length === 1 ? String(numbers[0]) : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;

export type ProblemSummary = {
  /** One sentence per kind of problem, in the order first met, without duplicates. */
  sentences: string[];
  /** Every original line, for the collapsed "Details" list. */
  details: string[];
};

/** The sentences a card prints for a draft's problem lines, and the raw lines for Details. */
export function summarizeProblems(problems: readonly string[]): ProblemSummary {
  const sentences: string[] = [];
  const formulas: number[] = [];
  let formulaSlot = -1;
  for (const line of problems) {
    const formula = FORMULA_PROBLEM.exec(line);
    if (formula) {
      formulas.push(Number(formula[1]));
      if (formulaSlot < 0) {
        formulaSlot = sentences.length;
        sentences.push('');
      }
      continue;
    }
    const sentence = KNOWN_PROBLEMS.find((known) => known.test.test(line))?.sentence ?? GENERIC_PROBLEM_SENTENCE;
    if (!sentences.includes(sentence)) sentences.push(sentence);
  }
  if (formulaSlot >= 0) {
    const unique = [...new Set(formulas)].sort((a, b) => a - b);
    sentences[formulaSlot] =
      unique.length === 1 ? `Formula ${unique[0]} could not be typeset.` : `Formulas ${joinNumbers(unique)} could not be typeset.`;
  }
  return { sentences, details: [...problems] };
}
