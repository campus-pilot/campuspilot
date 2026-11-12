import { describe, expect, it } from 'vitest';

import { DOCUMENT_MARKETPLACE, SAMPLE_QUESTION_PAPER_CONTEXT } from '../document/document.catalog';
import {
  assertValidSchoolQuestionPaperTemplate,
  exampleQuestionPaperBody,
  QUESTION_PAPER_MAX_LOGO_USES,
  renderQuestionPaperDocument,
  renderSampleQuestionPaperDocument,
} from './question-paper.render';
import { QUESTION_PAPER_SLOT, QUESTION_PAPER_SLOT_MESSAGE } from './question-paper.slot';

const designs = DOCUMENT_MARKETPLACE.filter((design) => design.documentType === 'question_paper');
const body = { html: '<div class="qp-body"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>Hello</div>', hasMath: false, figureCount: 0, byteSize: 100, warnings: [] };
const render = (template: string, context = SAMPLE_QUESTION_PAPER_CONTEXT) =>
  renderQuestionPaperDocument({ template: { content: template }, context, body });

describe('the example body', () => {
  it('is the rendered English science paper, with fonts for its formula', () => {
    const example = exampleQuestionPaperBody();
    expect(example).toBe(exampleQuestionPaperBody());
    expect(example.hasMath).toBe(true);
    expect(example.html).toContain('Which gas is released during photosynthesis?');
    expect(example.html).toContain('@font-face');
  });
});

describe.each(designs.map((design) => [design.slug, design.content] as const))('marketplace design %s', (_slug, content) => {
  it('is a valid school template and previews with the example paper in its slot', () => {
    expect(() => assertValidSchoolQuestionPaperTemplate(content)).not.toThrow();
    const html = renderSampleQuestionPaperDocument(content);
    expect(html).toContain('Greenwood Public School');
    expect(html).toContain('Which gas is released during photosynthesis?');
    expect(html).not.toContain(QUESTION_PAPER_SLOT);
    expect(html).toContain('font-src data:');
  });
});

describe('renderQuestionPaperDocument', () => {
  it('substitutes the body after sanitising, so SVG survives while the template\'s own script does not', () => {
    const html = render('<script>alert(1)</script><header onclick="x()">Head</header>{{{questionPaper.bodyHtml}}}<footer>Foot</footer>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>Hello');
    expect(html.indexOf('Head')).toBeLessThan(html.indexOf('Hello'));
    expect(html.indexOf('Hello')).toBeLessThan(html.indexOf('Foot'));
    expect(html).toContain('class="question-paper-document"');
  });

  it('gives the template the context and only the slot placeholder as the body', () => {
    const html = render('<h1>{{school.name}} {{exam.name}} {{questionPaper.subjectName}} {{questionPaper.maxMarks}}</h1><p>{{questionPaper.bodyHtml}}</p>{{{questionPaper.bodyHtml}}}');
    expect(html).toContain('Greenwood Public School Half Yearly Examination Science 20');
    // The escaped copy is text, not a second slot.
    expect(html).toContain('&lt;div class="qp-body" id="qp-body-slot"&gt;');
  });

  it.each([
    ['not placed', '<main>No questions</main>'],
    ['escaped', '<main>{{questionPaper.bodyHtml}}</main>'],
    ['inside an attribute', '<main title="{{{questionPaper.bodyHtml}}}">x</main>'],
    ['hidden by a false condition', '{{#if questionPaper.missing}}{{{questionPaper.bodyHtml}}}{{/if}}'],
    ['placed twice', '{{{questionPaper.bodyHtml}}}<hr>{{{questionPaper.bodyHtml}}}'],
    ['repeated by each', '{{#each exam}}{{{@root.questionPaper.bodyHtml}}}{{/each}}'],
  ])('refuses a template that leaves the slot %s', (_label, template) => {
    expect(() => render(template)).toThrow(QUESTION_PAPER_SLOT_MESSAGE);
    expect(() => assertValidSchoolQuestionPaperTemplate(template)).toThrow(QUESTION_PAPER_SLOT_MESSAGE);
  });

  it('holds the template to the 2,000,000 character render budget, whatever the body is', () => {
    expect(() => render(`<p>${'x'.repeat(2_000_100)}</p>{{{questionPaper.bodyHtml}}}`)).toThrow(/rendering limit/);
    expect(() => render(`<p>${'x'.repeat(1_900_000)}</p>{{{questionPaper.bodyHtml}}}`)).not.toThrow();
  });

  it('uses the school logo at most three times, and prints it where the template asked', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const context = { ...SAMPLE_QUESTION_PAPER_CONTEXT, school: { ...SAMPLE_QUESTION_PAPER_CONTEXT.school, logoUrl: logo } };
    const uses = (count: number) => `${'<img src="{{school.logoUrl}}" alt="logo">'.repeat(count)}{{{questionPaper.bodyHtml}}}`;
    const html = render(uses(QUESTION_PAPER_MAX_LOGO_USES), context);
    expect(html.split(logo).length - 1).toBe(QUESTION_PAPER_MAX_LOGO_USES);
    expect(() => render(uses(QUESTION_PAPER_MAX_LOGO_USES + 1), context)).toThrow(/at most 3 times/);
  });

  it('prints nothing for a logo the sanitiser would not keep', () => {
    const context = { ...SAMPLE_QUESTION_PAPER_CONTEXT, school: { ...SAMPLE_QUESTION_PAPER_CONTEXT.school, logoUrl: 'data:image/svg+xml;base64,AAAA' } };
    const html = render('<img src="{{school.logoUrl}}" alt="x">{{{questionPaper.bodyHtml}}}', context);
    expect(html).not.toContain('svg+xml');
  });

  it('refuses unsupported helpers and syntax like every other template', () => {
    expect(() => render('{{log "x"}}{{{questionPaper.bodyHtml}}}')).toThrow();
    expect(() => render('{{#if}}{{{questionPaper.bodyHtml}}}')).toThrow();
  });
});
