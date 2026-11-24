import { afterEach, describe, expect, it, vi } from 'vitest';

import { PDFDocument } from 'pdf-lib';

import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';

import { DOCUMENT_MARKETPLACE, SAMPLE_DOCUMENT_CONTEXT, SAMPLE_NOTICE_CONTEXT } from './document.catalog';
import {
  PREVIEW_TIMEOUT_MESSAGE,
  previewTemplateHtml,
  previewTemplatePdf,
  TEMPLATE_PREVIEW_LIMITS,
} from './document.template-source';

/**
 * A PDF of `pages` pages, as the converter would return it. Each page draws a
 * mark: a page pdf-lib adds bare has no content stream, which a converted page
 * always has and which half-A4 imposition needs to embed it.
 */
async function pdfWithPages(pages: number) {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < pages; page += 1) pdf.addPage().drawRectangle({ x: 10, y: 10, width: 10, height: 10 });
  return Buffer.from(await pdf.save());
}

/** The form the converter was sent by the `call`-th request. */
const formOf = (fetchMock: ReturnType<typeof vi.spyOn>, call = 0) => (fetchMock.mock.calls[call]![1] as RequestInit).body as FormData;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('half-A4 preview', () => {
  it('fills the sheet with two copies of the sample, as half-A4 documents print', () => {
    const items = (pageSize: 'full' | 'half') => previewTemplateHtml('<p>{{school.name}}</p>', 'admit_card', pageSize, undefined).match(/class="sheet-item"/g) ?? [];
    expect(items('half')).toHaveLength(2);
    expect(items('full')).toHaveLength(1);
  });
});

describe('template preview limits (docs/document-system.md, "Preview limits")', () => {
  it('renders every marketplace design within the preview render budget, a Notice design at both print sizes', () => {
    for (const design of DOCUMENT_MARKETPLACE) {
      const sizes = design.documentType === 'notice' ? (['full', 'half'] as const) : [undefined];
      for (const size of sizes) {
        expect(() => previewTemplateHtml(design.content, design.documentType, design.pageSize, size), `${design.slug} ${size ?? ''}`).not.toThrow();
      }
    }
  });

  it('refuses a template whose sample render passes the preview budget, far below the 25,000,000 a batch may use', () => {
    // About 3 MB: the 1 KB sample logo printed 3,000 times.
    const content = '{{school.logoUrl}}'.repeat(3_000);
    expect(() => previewTemplateHtml(content, 'id_card', 'full', undefined)).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(TEMPLATE_PREVIEW_LIMITS.renderChars).toBeLessThan(25_000_000 / 10);
  });

  it.each([
    ['id_card', TEMPLATE_PREVIEW_LIMITS.pages.id_card],
    ['timetable', TEMPLATE_PREVIEW_LIMITS.pages.timetable],
    ['notice', TEMPLATE_PREVIEW_LIMITS.pages.notice],
    ['question_paper', QUESTION_PAPER_LIMITS.pdfPages],
  ] as const)('asks the converter for one page more than the %s preview cap and passes a preview within it', async (type, pages) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(await pdfWithPages(1), { status: 200 }));
    const content = type === 'question_paper' ? '<main>{{{questionPaper.bodyHtml}}}</main>' : '<p>{{school.name}}</p>';
    await expect(previewTemplatePdf(content, type, 'full', undefined)).resolves.toBeInstanceOf(Uint8Array);
    expect(formOf(fetchMock).get('nativePageRanges')).toBe(`1-${pages + 1}`);
  });

  it('refuses a preview over its page cap with a sentence, never cutting it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(await pdfWithPages(TEMPLATE_PREVIEW_LIMITS.pages.bill + 1), { status: 200 }));
    await expect(previewTemplatePdf('<p>{{school.name}}</p>', 'bill', 'full', undefined)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining(`more than ${TEMPLATE_PREVIEW_LIMITS.pages.bill} pages`),
    });
  });

  it('refuses a preview the converter did not finish in time as the template’s problem, not a server error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(previewTemplatePdf('<p>{{school.name}}</p>', 'receipt', 'full', undefined)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: PREVIEW_TIMEOUT_MESSAGE,
    });
  });

  it('passes a caller’s abort and a converter failure on unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));
    await expect(previewTemplatePdf('<p>x</p>', 'receipt', 'full', undefined)).rejects.toMatchObject({ name: 'AbortError' });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(previewTemplatePdf('<p>x</p>', 'receipt', 'full', undefined)).rejects.toThrow('PDF conversion failed (503).');
  });

  it('caps a half notice by its half pages, then prints each on an A4 sheet as two copies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(await pdfWithPages(3), { status: 200 }));
    const pdf = await PDFDocument.load(await previewTemplatePdf('<p>{{school.name}}</p>', 'notice', 'full', 'half'));
    expect(formOf(fetchMock).get('nativePageRanges')).toBe(`1-${TEMPLATE_PREVIEW_LIMITS.pages.notice + 1}`);
    expect(pdf.getPageCount()).toBe(3);
    for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: expect.closeTo(595.28, 0), height: expect.closeTo(841.89, 0) });
  });
});

describe('a preview context with real images', () => {
  // A school logo of about 2 MB as a data URI: alone more than the 2,000,000 render budget.
  const bigLogo = `data:image/png;base64,${'A'.repeat(2_100_000)}`;
  const withLogo = { ...SAMPLE_DOCUMENT_CONTEXT, school: { ...SAMPLE_DOCUMENT_CONTEXT.school, logoUrl: bigLogo } };

  it('renders the context it is given, not the sample', () => {
    const context = { ...SAMPLE_DOCUMENT_CONTEXT, school: { ...SAMPLE_DOCUMENT_CONTEXT.school, name: 'Riverside High' } };
    const html = previewTemplateHtml('<p>{{school.name}}</p>', 'id_card', 'full', undefined, context);
    expect(html).toContain('Riverside High');
    expect(html).not.toContain(SAMPLE_DOCUMENT_CONTEXT.school.name);
  });

  it('lets a large logo print up to the image allowance, beyond the plain render budget', () => {
    const uses = TEMPLATE_PREVIEW_LIMITS.imageUses;
    const content = '<img src="{{school.logoUrl}}" alt="Logo">'.repeat(uses);
    expect(previewTemplateHtml(content, 'report_card', 'full', undefined, withLogo).split(bigLogo).length - 1).toBe(uses);
    expect(() => previewTemplateHtml(`${content}${'<img src="{{school.logoUrl}}" alt="Logo">'}`, 'report_card', 'full', undefined, withLogo)).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });

  it('renders a Notice design as a notice, with the school logo placed after the budget', () => {
    const notice = { ...SAMPLE_NOTICE_CONTEXT, school: { ...SAMPLE_NOTICE_CONTEXT.school, logoUrl: bigLogo } };
    const html = previewTemplateHtml('<img src="{{school.logoUrl}}" alt="Logo"><p>{{notice.title}}</p>', 'notice', 'full', undefined, notice);
    expect(html.split(bigLogo).length - 1).toBe(1);
  });
});
