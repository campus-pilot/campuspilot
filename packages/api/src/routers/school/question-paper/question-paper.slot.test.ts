import { describe, expect, it } from 'vitest';

import { SAMPLE_QUESTION_PAPER_CONTEXT } from '../document/document.catalog';
import {
  combineDocuments,
  documentContentSecurityPolicy,
  renderDocument,
} from '../document/document.render';
import {
  assertSingleQuestionPaperSlot,
  countQuestionPaperSlots,
  QUESTION_PAPER_SLOT,
  QUESTION_PAPER_SLOT_MESSAGE,
  substituteQuestionPaperBody,
} from './question-paper.slot';

/** What the renderer does for a school template: render, combine (sanitise), then check the slot. */
function sanitized(template: string) {
  return combineDocuments(
    [renderDocument(template, SAMPLE_QUESTION_PAPER_CONTEXT)],
    'question_paper',
  );
}

describe('question paper body slot', () => {
  it('survives sanitising exactly once when the template places it in element content', () => {
    const html = sanitized('<header>Heading</header>{{{questionPaper.bodyHtml}}}<footer>Foot</footer>');
    expect(countQuestionPaperSlots(html)).toBe(1);
    expect(() => assertSingleQuestionPaperSlot(html)).not.toThrow();
  });

  it.each([
    ['escaped with double braces', '<main>{{questionPaper.bodyHtml}}</main>'],
    ['inside an attribute', '<main title="{{{questionPaper.bodyHtml}}}">x</main>'],
    ['hidden by a false condition', '{{#if questionPaper.nothing}}{{{questionPaper.bodyHtml}}}{{/if}}<main>x</main>'],
    ['not placed at all', '<main>No questions here</main>'],
  ])('is refused when %s (zero slots)', (_label, template) => {
    const html = sanitized(template);
    expect(countQuestionPaperSlots(html)).toBe(0);
    expect(() => substituteQuestionPaperBody(html, '<p>body</p>')).toThrow(QUESTION_PAPER_SLOT_MESSAGE);
  });

  it.each([
    ['written twice', '{{{questionPaper.bodyHtml}}}<hr>{{{questionPaper.bodyHtml}}}'],
    ['repeated by each', '{{#each exam}}{{{@root.questionPaper.bodyHtml}}}{{/each}}'],
    ['forged by the author next to the real one', `${QUESTION_PAPER_SLOT}{{{questionPaper.bodyHtml}}}`],
  ])('is refused when %s (several slots)', (_label, template) => {
    const html = sanitized(template);
    expect(countQuestionPaperSlots(html)).toBeGreaterThan(1);
    expect(() => substituteQuestionPaperBody(html, '<p>body</p>')).toThrow(QUESTION_PAPER_SLOT_MESSAGE);
  });

  it('puts the body after sanitising, so inline SVG and data fonts survive', () => {
    const html = sanitized('<header>H</header>{{{questionPaper.bodyHtml}}}');
    // What the sanitiser alone would destroy: KaTeX radicals are inline SVG.
    const body = '<div class="qp-body"><svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg><style>@font-face{src:url(data:font/woff2;base64,AAAA)}</style></div>';
    expect(renderDocument(`<div>${body}</div>`, {})).not.toContain('<svg');
    const out = substituteQuestionPaperBody(html, body);
    expect(out).toContain('<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>');
    expect(out).toContain('url(data:font/woff2;base64,AAAA)');
    expect(out).not.toContain(QUESTION_PAPER_SLOT);
  });

  it('inserts the body literally: replacement patterns in the text are not interpreted', () => {
    const html = sanitized('<header>H</header>{{{questionPaper.bodyHtml}}}');
    const body = '<p>Cost is $& and $1 and $$ and $`</p>';
    expect(substituteQuestionPaperBody(html, body)).toContain(body);
  });

  it('leaves the rest of the sanitised template untouched', () => {
    const html = sanitized('<header>Heading</header>{{{questionPaper.bodyHtml}}}<footer>Foot</footer>');
    const out = substituteQuestionPaperBody(html, '<p>body</p>');
    expect(out.replace('<p>body</p>', QUESTION_PAPER_SLOT)).toBe(html);
  });
});

describe('question paper document wrapper', () => {
  it('adds font-src data: to the CSP of question papers only', () => {
    expect(documentContentSecurityPolicy('question_paper')).toContain("font-src data:");
    for (const type of ['report_card', 'id_card', 'admit_card', 'timetable', 'bill', 'receipt', 'statement', 'notice'] as const) {
      expect(documentContentSecurityPolicy(type), type).not.toContain('font-src');
      expect(combineDocuments([renderDocument('<p>x</p>', {})], type), type).not.toContain('font-src');
    }
    expect(documentContentSecurityPolicy()).not.toContain('font-src');
    expect(combineDocuments([renderDocument('<p>x</p>', {})], 'question_paper')).toContain('font-src data:');
  });

  it('widens nothing else: still no network, script or frame', () => {
    const csp = documentContentSecurityPolicy('question_paper');
    expect(csp).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; font-src data:",
    );
    expect(csp).not.toMatch(/script-src|connect-src|frame-src|https?:/);
  });

  it('still strips scripts, handlers and external images from the template', () => {
    const html = combineDocuments(
      [
        renderDocument(
          '<script>alert(1)</script><p onclick="alert(2)">Safe</p><img src="https://example.com/a.png">{{{questionPaper.bodyHtml}}}',
          SAMPLE_QUESTION_PAPER_CONTEXT,
        ),
      ],
      'question_paper',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('example.com');
    expect(html).toContain('Safe');
  });

  it('lays out flowing full A4 pages with the footer margin and no clipping', () => {
    const html = combineDocuments([renderDocument('<p>x</p>', {})], 'question_paper');
    expect(html).toContain('@page{size:A4;margin:14mm 14mm 10mm}');
    expect(html).toContain('class="question-paper-document"');
    // The footer band is a repeating table footer, so a fixed footer never covers a question.
    expect(html).toMatch(/<tfoot><tr><td><div class="qp-footer-band"><\/div><\/td><\/tr><\/tfoot>/);
    expect(html).toContain('.qp-footer-band{height:14mm}');
    expect(html).not.toContain('print-sheet');
    expect(html).not.toMatch(/overflow\s*:\s*hidden/);
    expect(html).not.toMatch(/[^-]height\s*:\s*297mm/);
  });
});
