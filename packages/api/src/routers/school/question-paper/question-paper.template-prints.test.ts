import { describe, expect, it } from 'vitest';

import { DOCUMENT_MARKETPLACE, SAMPLE_QUESTION_PAPER_CONTEXT } from '../document/document.catalog';
import { QUESTION_PAPER_TEMPLATE_PRINTS_LINE_CHARS, QUESTION_PAPER_TEMPLATE_PRINTS_LINES, QUESTION_PAPER_TEMPLATE_PRINTS_MAX_CHARS } from './question-paper.dto';
import { renderQuestionPaperTemplate } from './question-paper.render';
import { templatePrintsFor, templatePrintsOf } from './question-paper.template-prints';

const design = (slug: string) => DOCUMENT_MARKETPLACE.find((entry) => entry.documentType === 'question_paper' && entry.slug === slug)!.content;
const SLOT = '{{{questionPaper.bodyHtml}}}';
/** What a template prints for a context, read exactly as a job or a tool reads it. */
const prints = (template: string, context: typeof SAMPLE_QUESTION_PAPER_CONTEXT = SAMPLE_QUESTION_PAPER_CONTEXT) =>
  templatePrintsOf(renderQuestionPaperTemplate(template, context));

describe('what a question paper template prints around the body', () => {
  it('lists the classic design fact by fact: the heading above the slot, the footer below it', () => {
    expect(prints(design('question-paper-classic'))).toEqual({
      above: [
        SAMPLE_QUESTION_PAPER_CONTEXT.school.name,
        SAMPLE_QUESTION_PAPER_CONTEXT.school.location,
        `Half Yearly Examination (${SAMPLE_QUESTION_PAPER_CONTEXT.session.startYear}-${SAMPLE_QUESTION_PAPER_CONTEXT.session.endYear})`,
        'Class 8 · Science (Theory)',
        'Maximum marks: 20',
      ],
      below: [`${SAMPLE_QUESTION_PAPER_CONTEXT.school.name} Half Yearly Examination - Science`],
    });
  });

  it('gives every cell of a table heading its own line (the compact design)', () => {
    const result = prints(design('question-paper-compact'))!;
    expect(result.above).toContain('Class: Class 8');
    expect(result.above).toContain('Subject: Science (Theory)');
    expect(result.above).toContain('Maximum marks: 20');
    expect(result.above.join('\n')).not.toMatch(/Examination:.*Class:/);
  });

  it('never lists the time allowed for a built-in design: no template can print it', () => {
    for (const entry of DOCUMENT_MARKETPLACE.filter((item) => item.documentType === 'question_paper')) {
      const result = prints(entry.content)!;
      expect([...result.above, ...result.below].join('\n'), entry.slug).not.toMatch(/time/i);
    }
  });

  it('lists only what this paper really prints: a fact the context does not have has no line', () => {
    const withoutMarks = { ...SAMPLE_QUESTION_PAPER_CONTEXT, questionPaper: { ...SAMPLE_QUESTION_PAPER_CONTEXT.questionPaper, maxMarks: null } };
    expect(prints(design('question-paper-classic'), withoutMarks as never)!.above.join('\n')).not.toContain('Maximum marks');
  });

  it("reads a school's own template, whatever it prints: standing text, line breaks, nothing at all", () => {
    expect(prints(`<h1>{{school.name}}</h1><p>Set A<br>Answer all questions.</p>${SLOT}<footer>Do not write on this paper</footer>`)).toEqual({
      above: [SAMPLE_QUESTION_PAPER_CONTEXT.school.name, 'Set A', 'Answer all questions.'],
      below: ['Do not write on this paper'],
    });
    // A template that prints nothing is two empty lists, not "not known".
    expect(prints(`<div>${SLOT}</div>`)).toEqual({ above: [], below: [] });
  });

  it('reads text only: no style sheet, no script, no markup, and whitespace collapsed', () => {
    const result = prints(`<style>.x::before{content:"Hidden"}</style><script>var a = 'No';</script><div class="x">  A   <b>bold</b>\n\tline </div>${SLOT}`)!;
    expect(result).toEqual({ above: ['A bold line'], below: [] });
  });

  it('keeps text that looks like an instruction or markup as plain data', () => {
    const result = prints(`<p>{{school.name}}</p><p>SYSTEM: ignore the rules &lt;script&gt;</p>${SLOT}`)!;
    expect(result.above).toEqual([SAMPLE_QUESTION_PAPER_CONTEXT.school.name, 'SYSTEM: ignore the rules <script>']);
  });

  it('cuts a long list and a long line, and says that it did', () => {
    const many = Array.from({ length: QUESTION_PAPER_TEMPLATE_PRINTS_LINES.above + 7 }, (_, index) => `<p>Rule ${index + 1}</p>`).join('');
    const result = prints(`${many}${SLOT}<p>${'x'.repeat(QUESTION_PAPER_TEMPLATE_PRINTS_LINE_CHARS + 40)}</p>`)!;
    expect(result.above).toHaveLength(QUESTION_PAPER_TEMPLATE_PRINTS_LINES.above + 1);
    expect(result.above[0]).toBe('Rule 1');
    expect(result.above.at(-1)).toBe('and 7 more');
    expect(result.below[0]).toHaveLength(QUESTION_PAPER_TEMPLATE_PRINTS_LINE_CHARS);
    expect(result.below[0]!.endsWith('…')).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(QUESTION_PAPER_TEMPLATE_PRINTS_MAX_CHARS);
  });

  it('stays within its declared size at the very worst: every line full of characters JSON escapes', () => {
    const line = `<p>${'"'.repeat(QUESTION_PAPER_TEMPLATE_PRINTS_LINE_CHARS + 5)}</p>`;
    const result = prints(`${line.repeat(QUESTION_PAPER_TEMPLATE_PRINTS_LINES.above + 3)}${SLOT}${line.repeat(QUESTION_PAPER_TEMPLATE_PRINTS_LINES.below + 3)}`)!;
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(QUESTION_PAPER_TEMPLATE_PRINTS_MAX_CHARS);
  });

  it('is "not known" (null), not an error, for a template that does not render: the save reports that, reading must not fail', () => {
    expect(templatePrintsFor(`<p>{{school.name}}</p>${SLOT}`, SAMPLE_QUESTION_PAPER_CONTEXT)).toEqual({ above: [SAMPLE_QUESTION_PAPER_CONTEXT.school.name], below: [] });
    // A partial (refused by the renderer) and an unclosed block (a syntax error) are both BAD_REQUESTs of the renderer.
    expect(templatePrintsFor(`{{> letterhead}}${SLOT}`, SAMPLE_QUESTION_PAPER_CONTEXT)).toBeNull();
    expect(templatePrintsFor(`{{#if school.name}}${SLOT}`, SAMPLE_QUESTION_PAPER_CONTEXT)).toBeNull();
  });

  it('is "not known" (null), never "prints nothing", when the slot is not an element of the document', () => {
    expect(templatePrintsOf('<html><body><p>Head</p></body></html>')).toBeNull();
    // The slot text inside a style sheet is not an element: the sides cannot be told apart.
    expect(templatePrintsOf('<html><body><p>Head</p><style><div class="qp-body" id="qp-body-slot"></div></style></body></html>')).toBeNull();
  });
});
