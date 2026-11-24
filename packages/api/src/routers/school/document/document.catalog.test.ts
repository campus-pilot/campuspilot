import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_TEMPLATE_SLUGS,
  DOCUMENT_MARKETPLACE,
  SAMPLE_BILL_DUE_CONTEXT,
  SAMPLE_DOCUMENT_CONTEXT,
  SAMPLE_QUESTION_PAPER_CONTEXT,
  sampleDocumentContext,
} from './document.catalog';
import { countQuestionPaperSlots } from '../question-paper/question-paper.slot';
import { scopeLegacyDocumentCss } from './document.catalog.marketplace';
import { renderDocument } from './document.render';
import { withReportModeLayout } from './document.report-modes';

function template(slug: string) {
  const item = DOCUMENT_MARKETPLACE.find((entry) => entry.slug === slug);
  if (!item) throw new Error(`Missing catalog template ${slug}`);
  return item;
}

function cssOf(html: string) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n');
}

/** Sample context with two assessment modes, so a mode column cannot be
 * confused with the single total column, and explicit print choices. */
function reportContext(includeModeMarks: boolean) {
  return withReportModeLayout({
    ...SAMPLE_DOCUMENT_CONTEXT,
    subjects: SAMPLE_DOCUMENT_CONTEXT.subjects.map((subject, index) => ({
      ...subject,
      marks: { written: 70 + index, oral: 17 + index },
      modeConfig: {
        written: { name: 'Written', percentage: 80, maxMarks: 80 },
        oral: { name: 'Oral', percentage: 20, maxMarks: 20 },
      },
    })),
    reportSections: {
      ...SAMPLE_DOCUMENT_CONTEXT.reportSections,
      includeModeMarks,
    },
  });
}

/** Mathematics has Written and Oral, English only Written (with a different
 * maximum), as when a school configures modes per subject. */
function mixedModeContext() {
  const [mathematics, english] = SAMPLE_DOCUMENT_CONTEXT.subjects;
  const subjects: Array<
    Record<string, unknown> & {
      marks: Record<string, number>;
      modeConfig: Record<string, { name: string; percentage: number; maxMarks: number }>;
    }
  > = [
    {
      ...english!,
      marks: { written: 0 },
      modeConfig: { written: { name: 'Written', percentage: 100, maxMarks: 100 } },
    },
    {
      ...mathematics!,
      marks: { oral: 18, written: 70 },
      modeConfig: {
        oral: { name: 'Oral', percentage: 20, maxMarks: 20 },
        written: { name: 'Written', percentage: 80, maxMarks: 80 },
      },
    },
  ];
  return withReportModeLayout({ ...SAMPLE_DOCUMENT_CONTEXT, subjects });
}

function rowCellCounts(html: string) {
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) => {
    const cells = [...row[1]!.matchAll(/<t[dh](?: colspan="(\d+)")?[^>]*>/g)];
    return cells.reduce((sum, cell) => sum + Number(cell[1] ?? 1), 0);
  });
}

describe('document template marketplace', () => {
  it('offers the legacy catalog plus matching statement designs and the CampusPilot Standard set', () => {
    const expected = {
      report_card: ['default', 'default-attendance', 'minimal'],
      id_card: ['default', 'modern', 'minimal', 'classic'],
      admit_card: ['default', 'with-timetable', 'minimal'],
      timetable: ['default', 'centered'],
      bill: ['default', 'compact', 'default-full'],
      receipt: ['default', 'compact', 'default-full'],
      statement: ['default', 'compact', 'default-full'],
      notice: ['default', 'compact'],
      question_paper: ['classic', 'compact'],
    } as const;
    // Slugs follow the document type, except that the question paper designs
    // use hyphens (`question-paper-classic`). The Standard set is
    // `standard-<type with hyphens>`, one per type except statements and notices.
    const slugPrefix = (documentType: string) =>
      documentType === 'question_paper' ? 'question-paper' : documentType;
    const standard = (documentType: string) =>
      documentType === 'statement' || documentType === 'notice' ? [] : [`standard-${documentType.replaceAll('_', '-')}`];
    for (const [documentType, variants] of Object.entries(expected)) {
      const items = DOCUMENT_MARKETPLACE.filter(
        (item) => item.documentType === documentType,
      );
      expect(items.map((item) => item.slug)).toEqual([
        ...variants.map((variant) => `${slugPrefix(documentType)}-${variant}`),
        ...standard(documentType),
      ]);
      for (const item of items) {
        expect(item.content).toContain('school.logoUrl');
        expect(item.content).toContain('alt="School logo"');
      }
    }
  });

  it('marks only supported legacy finance and admit-card designs as half A4', () => {
    const half = DOCUMENT_MARKETPLACE.filter(
      (item) => item.pageSize === 'half',
    ).map((item) => item.slug);
    expect(half).toEqual([
      'admit_card-default',
      'admit_card-with-timetable',
      'admit_card-minimal',
      'bill-default',
      'bill-compact',
      'receipt-default',
      'receipt-compact',
      'statement-default',
      'statement-compact',
      'standard-admit-card',
      'standard-bill',
      'standard-receipt',
    ]);
  });

  describe('CampusPilot Standard defaults', () => {
    it('name one existing design of the right type for every type a new school starts with, without a paper size in the name', () => {
      expect(Object.keys(DEFAULT_DOCUMENT_TEMPLATE_SLUGS).sort()).toEqual(
        ['admit_card', 'bill', 'id_card', 'question_paper', 'receipt', 'report_card', 'statement', 'timetable'],
      );
      for (const [documentType, slug] of Object.entries(DEFAULT_DOCUMENT_TEMPLATE_SLUGS)) {
        const design = template(slug);
        expect(design.documentType, slug).toBe(documentType);
        if (slug.startsWith('standard-')) {
          expect(design.name, slug).toMatch(/^CampusPilot Standard /);
          expect(design.name, slug).not.toMatch(/A4/);
        }
      }
      // Statements reuse the existing full-A4 design.
      expect(DEFAULT_DOCUMENT_TEMPLATE_SLUGS.statement).toBe('statement-default-full');
    });

    it('print the admit card, bill and receipt on half A4 and everything else on full A4', () => {
      const half = Object.values(DEFAULT_DOCUMENT_TEMPLATE_SLUGS).filter((slug) => template(slug).pageSize === 'half');
      expect(half.sort()).toEqual(['standard-admit-card', 'standard-bill', 'standard-receipt']);
    });

    it('leave out the school-specific affiliation line of the timetable', () => {
      const { content } = template('standard-timetable');
      expect(content).not.toContain('Bihar');
      expect(content).not.toContain('Affiliated');
      expect(renderDocument(content, SAMPLE_DOCUMENT_CONTEXT)).toContain('Greenwood Public School');
    });

    it('print a Bill due with the Standard bill: DUE number, Statement Through, credit rows and the amount due', () => {
      const due = renderDocument(template('standard-bill').content, SAMPLE_BILL_DUE_CONTEXT);
      expect(due).toContain('DUE/24/11/2026');
      expect(due).toContain('Statement Through');
      expect(due).toContain('01/11/2026 – 30/11/2026');
      expect(due).toContain('Discount');
      expect(due).toContain('Payment RCP/2026-27/000087 (10/11/2026)');
      expect(due).toContain('1100.00');
      expect(due).not.toContain('monthly:2026-11');
      const bill = renderDocument(template('standard-bill').content, SAMPLE_DOCUMENT_CONTEXT);
      expect(bill).toContain('B/2026/000001');
      expect(bill).not.toContain('DUE/');
      expect(bill).not.toContain('Statement Through');
    });
  });

  it("keeps printing a Bill due with Prem Chandra's production bill template, unchanged", () => {
    const production = readFileSync(new URL('./__fixtures__/prem-production-bill.hbs', import.meta.url), 'utf8');
    const html = renderDocument(production, SAMPLE_BILL_DUE_CONTEXT);
    expect(html).toContain('Tuition fee');
    expect(html).toContain('Transport fee');
    expect(html).toContain('INR 1300.00');
    expect(html).toContain('INR 800.00');
    expect(html).toContain('-INR 200.00');
    expect(html).toContain('INR 1100.00');
    expect(html).toContain('2026-11-24');
  });

  it('stores every Notice design as full: designs adapt to each notice\'s print size instead of having a footprint', () => {
    for (const item of DOCUMENT_MARKETPLACE.filter(({ documentType }) => documentType === 'notice')) {
      expect(item.pageSize, item.slug).toBe('full');
      expect(item.content, item.slug).toContain('{{print.size}}');
    }
  });

  describe('question paper designs', () => {
    const designs = DOCUMENT_MARKETPLACE.filter(
      ({ documentType }) => documentType === 'question_paper',
    );

    it('are full A4 only', () => {
      expect(designs.length).toBeGreaterThanOrEqual(2);
      for (const item of designs) expect(item.pageSize, item.slug).toBe('full');
    });

    it('place the body slot exactly once, in element content', () => {
      for (const item of designs) {
        expect(item.content.split('{{{questionPaper.bodyHtml}}}'), item.slug).toHaveLength(2);
        expect(item.content, item.slug).not.toMatch(/(?<!\{)\{\{questionPaper\.bodyHtml\}\}(?!\})/);
        const html = renderDocument(item.content, SAMPLE_QUESTION_PAPER_CONTEXT);
        expect(countQuestionPaperSlots(html), item.slug).toBe(1);
      }
    });

    it('flow: no clipping, and a repeating fixed footer after the body', () => {
      // The CampusPilot Standard design is a school's own heading without a
      // footer (a frozen copy, docs/document-system.md "Default templates");
      // every design with a footer must repeat it.
      for (const item of designs) {
        const css = cssOf(item.content);
        expect(css, item.slug).not.toMatch(/overflow\s*:\s*hidden/);
        if (item.slug === 'standard-question-paper') {
          expect(item.content, item.slug).not.toContain('<footer');
          continue;
        }
        expect(css, item.slug).toMatch(/position\s*:\s*fixed;\s*bottom\s*:\s*0;/);
        // The header is in normal flow, the footer is after the body.
        const body = item.content.indexOf('{{{questionPaper.bodyHtml}}}');
        expect(item.content.indexOf('</header>'), item.slug).toBeLessThan(body);
        expect(item.content.indexOf('<footer'), item.slug).toBeGreaterThan(body);
      }
    });

    it('set the direction through CSS, because the sanitiser drops the dir attribute', () => {
      for (const item of designs) {
        expect(item.content, item.slug).toContain('style="direction:{{questionPaper.direction}}"');
        const html = renderDocument(item.content, {
          ...SAMPLE_QUESTION_PAPER_CONTEXT,
          questionPaper: { ...SAMPLE_QUESTION_PAPER_CONTEXT.questionPaper, direction: 'rtl' },
        });
        expect(html, item.slug).toContain('direction:rtl');
      }
    });

    it('keep Devanagari-capable font stacks and guard every optional fact', () => {
      for (const item of designs) {
        expect(item.content, item.slug).toContain('Noto Sans Devanagari');
        const sparse = renderDocument(item.content, {
          ...SAMPLE_QUESTION_PAPER_CONTEXT,
          school: { ...SAMPLE_QUESTION_PAPER_CONTEXT.school, location: null, registrationNo: null, logoUrl: null },
          questionPaper: { ...SAMPLE_QUESTION_PAPER_CONTEXT.questionPaper, timeAllowed: null, maxMarks: null, totalMarks: null },
        });
        expect(sparse, item.slug).not.toContain('Maximum marks');
        expect(sparse, item.slug).not.toContain('Time:');
        expect(sparse, item.slug).not.toContain('null');
        expect(sparse, item.slug).not.toContain('<img');
      }
    });

    it('print a Hindi heading when the school and exam names are Hindi', () => {
      for (const item of designs) {
        const html = renderDocument(item.content, {
          ...SAMPLE_QUESTION_PAPER_CONTEXT,
          school: { ...SAMPLE_QUESTION_PAPER_CONTEXT.school, name: 'ग्रीनवुड पब्लिक स्कूल' },
          exam: { ...SAMPLE_QUESTION_PAPER_CONTEXT.exam, name: 'अर्धवार्षिक परीक्षा' },
        });
        expect(html, item.slug).toContain('ग्रीनवुड पब्लिक स्कूल');
        expect(html, item.slug).toContain('अर्धवार्षिक परीक्षा');
      }
    });
  });

  it('keeps marketplace slugs unique', () => {
    const slugs = DOCUMENT_MARKETPLACE.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('renders every imported design with the current documented context', () => {
    for (const item of DOCUMENT_MARKETPLACE) {
      const html = renderDocument(item.content, sampleDocumentContext(item.documentType));
      expect(html, item.slug).toContain('Greenwood Public School');
      expect(html, item.slug).not.toContain('{{');
    }
  });

  it('adapts legacy report tables to the current independent mode-mark flag', () => {
    for (const item of DOCUMENT_MARKETPLACE.filter(
      ({ documentType }) => documentType === 'report_card',
    )) {
      expect(item.content, item.slug).toContain(
        'reportSections.includeModeMarks',
      );
    }
    for (const slug of [
      'report_card-default',
      'report_card-default-attendance',
    ]) {
      const content = DOCUMENT_MARKETPLACE.find(
        (item) => item.slug === slug,
      )!.content;
      expect(content, slug).toContain(
        'reportSections.includeCoScholastics',
      );
      expect(content, slug).toContain('reportSections.includeGradingScale');
    }
  });

  it('shows per-subject mode marks only when the independent print flag is set', () => {
    for (const slug of [
      'report_card-default',
      'report_card-default-attendance',
      'report_card-minimal',
    ]) {
      const shown = renderDocument(template(slug).content, reportContext(true));
      // Body cells come from inside {{#each subjects}}; the flag must be read
      // from the root context there, not from the subject.
      expect(shown, slug).toContain('Written');
      expect(shown, slug).toContain('>70</td>');
      expect(shown, slug).toContain('>17</td>');
      expect(shown, slug).toContain('>71</td>');
      expect(shown, slug).toContain('>18</td>');

      const hidden = renderDocument(template(slug).content, reportContext(false));
      expect(hidden, slug).not.toContain('Written');
      expect(hidden, slug).not.toContain('>70</td>');
      expect(hidden, slug).not.toContain('>17</td>');
    }
  });

  it('keeps every marks-table row aligned with its header', () => {
    for (const includeModeMarks of [true, false]) {
      for (const slug of ['report_card-default', 'report_card-minimal']) {
        const html = renderDocument(
          template(slug).content,
          reportContext(includeModeMarks),
        );
        const table = html.match(/<table>[\s\S]*?<\/table>/)![0];
        const counts = rowCellCounts(table);
        expect(new Set(counts).size, `${slug} ${includeModeMarks}`).toBe(1);
      }
      // The attendance design has a two-row header; its body rows and the
      // spanned summary rows must still have equal widths.
      const html = renderDocument(
        template('report_card-default-attendance').content,
        reportContext(includeModeMarks),
      );
      const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]!;
      expect(new Set(rowCellCounts(body)).size, String(includeModeMarks)).toBe(1);
      expect(html.includes('Obtained Marks'), String(includeModeMarks)).toBe(
        includeModeMarks,
      );
    }
  });

  it('builds mode columns from every subject and leaves a blank cell where a subject lacks a mode', () => {
    const context = mixedModeContext();
    expect(context.modeColumns).toEqual([
      { slug: 'oral', name: 'Oral', maxMarks: 20 },
      { slug: 'written', name: 'Written', maxMarks: null },
    ]);
    for (const slug of [
      'report_card-default',
      'report_card-default-attendance',
      'report_card-minimal',
    ]) {
      const html = renderDocument(template(slug).content, context);
      const header = html.match(/<thead>([\s\S]*?)<\/thead>/)![1]!;
      expect(header.indexOf('Oral'), slug).toBeGreaterThan(-1);
      expect(header.indexOf('Oral'), slug).toBeLessThan(header.indexOf('Written'));
      const rows = [...html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
        .map((row) => [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]!.trim()));
      // English: blank Oral cell, zero Written mark kept as zero.
      expect(rows[0]!.slice(1, 3), slug).toEqual(['', '0']);
      // Mathematics: Oral then Written, under their own headers.
      expect(rows[1]!.slice(1, 3), slug).toEqual(['18', '70']);
    }
  });

  it('honors the co-scholastic and grading-scale print flags', () => {
    for (const slug of ['report_card-default', 'report_card-default-attendance']) {
      const html = renderDocument(template(slug).content, {
        ...SAMPLE_DOCUMENT_CONTEXT,
        reportSections: {
          includeModeMarks: true,
          includeAttendance: true,
          includeCoScholastics: false,
          includeGradingScale: false,
        },
      });
      expect(html, slug).not.toContain('Art &amp; Craft');
      expect(html, slug).not.toContain('Minimum Score');
      expect(html, slug).not.toContain('&amp; above');
    }
  });

  it('resolves every context path of every design against the documented sample', async () => {
    const Handlebars = (await import('handlebars')).default;
    const strict = Handlebars.create();
    strict.registerHelper('add', (a: number, b: number) => a + b);
    for (const item of DOCUMENT_MARKETPLACE) {
      // Strict mode throws on a path that does not exist where it is read,
      // which catches wrong-scope paths and mis-renamed legacy fields.
      expect(
        () => strict.compile(item.content, { strict: true })(sampleDocumentContext(item.documentType)),
        item.slug,
      ).not.toThrow();
    }
  });

  it('renames legacy bill fields to whole current paths only, and reads the period, frequency and Statement Through from real fields', () => {
    for (const slug of ['bill-default', 'bill-compact', 'bill-default-full']) {
      const { content } = template(slug);
      expect(content, slug).not.toContain('periodKeyKey');
      expect(content, slug).not.toContain('bill.periodKey');
      expect(content, slug).not.toContain('statementDate');
      expect(content, slug).toContain('bill.period.cadence');
      const bill = renderDocument(content, SAMPLE_DOCUMENT_CONTEXT);
      expect(bill, slug).toContain('monthly');
      expect(bill, slug).not.toContain('monthly:2026-10');
      expect(bill, slug).not.toContain('Statement Through');
      expect(bill, slug).toContain('B/2026/000001');
      const due = renderDocument(content, SAMPLE_BILL_DUE_CONTEXT);
      expect(due, slug).toContain('Statement Through');
      expect(due, slug).toContain('DUE/24/11/2026');
      expect(due, slug).toContain('Payment RCP/2026-27/000087');
      expect(due, slug).toContain('Discount');
      // Zero optional rows are hidden: no waiver, write-off or refund rows.
      expect(due, slug).not.toContain('Waiver');
    }
    // A bill whose cadence is unknown prints no frequency and no period.
    const unknown = renderDocument(template('bill-default').content, { ...SAMPLE_DOCUMENT_CONTEXT, bill: { ...SAMPLE_DOCUMENT_CONTEXT.bill, period: null } });
    expect(unknown).not.toContain('monthly');
    expect(unknown).not.toContain('31/10/2026');
  });

  it('keeps legacy class selectors that contain "body" when scoping the page root', () => {
    for (const [slug, selector] of [
      ['id_card-default', '.body'],
      ['id_card-classic', '.body'],
      ['admit_card-default', '.ac-body'],
      ['admit_card-minimal', '.acm-body'],
    ] as const) {
      const css = cssOf(template(slug).content);
      expect(css, slug).toMatch(
        new RegExp(`(^|[\\s,}])${selector.replace('.', '\\.')}\\s*\\{`),
      );
      expect(css, slug).not.toContain('..legacy-template');
      expect(css, slug).not.toContain('-.legacy-template');
    }
    for (const item of DOCUMENT_MARKETPLACE) {
      expect(cssOf(item.content), item.slug).not.toMatch(
        /(^|[\s,{};])(html|body)\s*[{,]/,
      );
    }
  });

  it('sizes admit-card fragments with border-box so they fit their slot', () => {
    for (const item of DOCUMENT_MARKETPLACE.filter(
      ({ documentType }) => documentType === 'admit_card',
    )) {
      expect(cssOf(item.content), item.slug).toContain(
        ':where(.legacy-template,.legacy-template *,.legacy-template *::before,.legacy-template *::after){box-sizing:border-box}',
      );
    }
  });
});

describe('legacy document CSS scoping', () => {
  it('rewrites only real html/body type selectors', () => {
    expect(scopeLegacyDocumentCss('body { margin: 0 }')).toBe(
      '.legacy-template { margin: 0 }',
    );
    expect(scopeLegacyDocumentCss('html, body{color:red}')).toBe(
      '.legacy-template {color:red}',
    );
    expect(scopeLegacyDocumentCss('html body .x{a:b}')).toBe(
      '.legacy-template .x {a:b}',
    );
    expect(scopeLegacyDocumentCss('body.dark > p{a:b}')).toBe(
      '.legacy-template.dark > p {a:b}',
    );
  });

  it('leaves class, id, attribute, compound names and declarations alone', () => {
    const css = [
      '.body{a:b}',
      '.ac-body{a:b}',
      '.acm-body .grid .k{a:b}',
      '#body{a:b}',
      'tbody td{a:b}',
      '.tbody{a:b}',
      '[data-part="body"]{a:b}',
      "[class~=body] span{a:b}",
      '.x{font-family:body, serif}',
      '@media print{.body{a:b}}',
    ];
    expect(scopeLegacyDocumentCss(css.join('\n'))).not.toContain(
      'legacy-template',
    );
    expect(scopeLegacyDocumentCss('@media print{body{a:b}}')).toBe(
      '@media print{.legacy-template {a:b}}',
    );
  });

  it('ignores selector-like text in comments', () => {
    expect(scopeLegacyDocumentCss('/* body */ .body{a:b}')).toBe('.body {a:b}');
  });
});
