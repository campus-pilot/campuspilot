import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { GENERIC_PROBLEM_SENTENCE, summarizeProblems } from '@campuspilot/components/question-paper/paper-problems-model';
import { sanitizeQuestionPaperBody } from '@campuspilot/api/routers/school/question-paper/question-paper.sanitize';

import { questionPaperFragmentShapeProblem } from '../../../../packages/question-paper/src/fragment';

/**
 * The teacher-facing sentences are matched on the start of the API's problem
 * lines (`paper-problems-model.ts`). These tests run the real producers, so a
 * reworded or new API line fails here instead of silently turning into the
 * generic sentence.
 */

const mapped = (line: string) => {
  const { sentences } = summarizeProblems([line]);
  assert.equal(sentences.length, 1, line);
  assert.notEqual(sentences[0], GENERIC_PROBLEM_SENTENCE, `unmapped API line: ${line}`);
};

const problemsOf = (html: string) => sanitizeQuestionPaperBody(html).problems;

test('every limit the sanitiser reports has a teacher sentence', () => {
  const cases: Record<string, string> = {
    'too long after cleaning': `<p>${'a'.repeat(90_000)}</p>`,
    'too long before cleaning': 'x'.repeat(130_000),
    elements: '<p></p>'.repeat(8_100),
    svgs: '<svg></svg>'.repeat(41),
    'svg shapes': `<svg>${'<path d="M0 0L1 1"/>'.repeat(4_100)}</svg>`,
    'style blocks': `<style>${'.a{color:red}'.repeat(2_500)}</style><p>x</p>`,
    formulas: '<span data-math="x"></span>'.repeat(610),
    'long formula': `<p><span data-math="${'x'.repeat(520)}"></span></p>`,
    figures: '<figure data-placeholder="x"></figure>'.repeat(31),
  };
  for (const [name, html] of Object.entries(cases)) {
    const problems = problemsOf(html);
    assert.ok(problems.length > 0, `${name}: the sanitiser reported no problem; adjust the case`);
    for (const line of problems) mapped(line);
  }
});

test('the AI job fragment shape lines have teacher sentences', () => {
  for (const sample of ['I am sorry, I cannot do that.', 'Here it is: <p>Q</p>']) {
    const problem = questionPaperFragmentShapeProblem(sample);
    assert.ok(problem, sample);
    mapped(problem.message);
  }
});

test('lines produced outside the sanitiser keep their wording in the source', () => {
  // These need a database or an input the sanitiser cannot be made to produce; the producing sentence is pinned in its source.
  const source = (path: string) => readFileSync(new URL(`../../../../packages/api/src/routers/school/question-paper/${path}`, import.meta.url), 'utf8');
  const lines: Array<[string, string]> = [
    ['question-paper.sanitize.ts', 'The paper could not be cleaned safely ('],
    ['question-paper.version.service.ts', 'The paper is empty. Write the questions as HTML.'],
    ['question-paper.version.service.ts', 'The figure images of this paper are too large to print together.'],
    ['question-paper.version.service.ts', 'The formulas of this paper are too large to print.'],
    ['question-paper.version.service.ts', 'The formulas and figure images of this paper are too large to print together.'],
  ];
  for (const [file, line] of lines) {
    assert.ok(source(file).includes(line), `${file} no longer says: ${line}`);
    mapped(line.endsWith('(') ? `${line}reason). Simplify the markup.` : line);
  }
});
