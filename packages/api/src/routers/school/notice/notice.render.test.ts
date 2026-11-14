import Handlebars from 'handlebars';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type PdfPagePlacement, readPdfPageDrawing } from '../../../../test/pdf-placements';

import { DOCUMENT_MARKETPLACE, NOTICE_DEFAULT_TEMPLATE_SLUG, SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';
import { combineDocuments, renderDocument } from '../document/document.render';
import { NOTICE_CONTEXT_FIELDS, NOTICE_TEMPLATE_STARTER, NOTICE_TEMPLATE_VARIABLES } from './notice-template-guide';
import {
  assertValidNoticeTemplate,
  assertValidSchoolNoticeTemplate,
  imposeHalfPageNoticeCopies,
  NOTICE_MAX_LOGO_USES,
  NOTICE_PUBLISHED_RENDER_MAX_CHARS,
  NOTICE_RENDER_MAX_CHARS,
  NOTICE_TEMPLATE_MAX_BLOCK_DEPTH,
  noticeDocumentText,
  noticeParagraphs,
  noticePdfKey,
  renderNoticeDocument,
} from './notice.render';

const defaultTemplate = DOCUMENT_MARKETPLACE.find((item) => item.slug === NOTICE_DEFAULT_TEMPLATE_SLUG)!.content;

/** Renders a plain notice exactly as `renderNoticeHtml` does, without the database. */
function renderPlain(text: string, template = defaultTemplate, title = 'Sports Day') {
  const context = { ...SAMPLE_NOTICE_CONTEXT, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, title, paragraphs: noticeParagraphs(text) } };
  return combineDocuments([renderDocument(template, context)], 'notice', 'full');
}

/** Renders a template notice: the author's source is the whole document. */
function renderTemplate(source: string) {
  const context = { ...SAMPLE_NOTICE_CONTEXT, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, paragraphs: [] } };
  return combineDocuments([renderDocument(source, context)], 'notice', 'full');
}

describe('notice paragraphs', () => {
  it('splits at blank lines, keeps single line breaks and drops empty paragraphs', () => {
    expect(noticeParagraphs('First line\nsecond line\n\n\n  \nSecond paragraph  \r\n\r\nThird')).toEqual([
      'First line\nsecond line',
      'Second paragraph',
      'Third',
    ]);
    expect(noticeParagraphs('   \n\n  ')).toEqual([]);
  });
});

describe('plain notices', () => {
  it('prints the text escaped: markup and Handlebars typed by the author are shown, never run', () => {
    const html = renderPlain('<script>alert(1)</script> <img src=x onerror=alert(2)>\n\n{{school.name}} {{{notice.title}}} {{#each x}}');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Braces are data, not template syntax: the school name is not substituted into the text.
    expect(html).toContain('{{school.name}} {{{notice.title}}} {{#each x}}');
  });

  it('escapes the title and renders the school letterhead', () => {
    const html = renderPlain('Body', defaultTemplate, '<b>Bold</b> & "quoted"');
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; "quoted"');
    expect(html).not.toContain('<b>');
    expect(html).toContain('Greenwood Public School');
    expect(html).toContain('15 October 2026');
    expect(html).toContain('alt="School logo"');
  });

  it('stays safe when a school template prints the text unescaped: the sanitizer still removes active markup', () => {
    const unescaping = '<div>{{{notice.title}}}{{#each notice.paragraphs}}<p>{{{this}}}</p>{{/each}}</div>';
    const html = renderPlain('<script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">link</a><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="q"></form>', unescaping, '<img src="https://evil.example/pixel.png">');
    expect(html).not.toMatch(/<script|<iframe|<form|<input|onclick|javascript:|evil\.example/i);
    expect(html).toContain('Content-Security-Policy');
  });

  it('keeps one paragraph element per paragraph with the line breaks inside it', () => {
    const html = renderPlain('Line one\nLine two\n\nNext');
    const body = html.slice(html.indexOf('<main class="notice-body">'), html.indexOf('</main>'));
    expect(body.match(/<p>/g)).toHaveLength(2);
    expect(body).toContain('<p>Line one\nLine two</p>');
    expect(html).toContain('white-space:pre-wrap');
  });
});

describe('template notices', () => {
  it('renders the author source through the restricted renderer and sanitizer', () => {
    const html = renderTemplate('<h1 onclick="steal()">{{notice.title}}</h1><script>fetch("https://evil.example")</script><p>{{school.name}} {{session.startYear}}</p><link rel="stylesheet" href="https://evil.example/a.css"><img src="https://evil.example/a.png">');
    expect(html).toContain('<h1>Annual Sports Day</h1>');
    expect(html).toContain('Greenwood Public School 2026');
    expect(html).not.toMatch(/<script|onclick|evil\.example|<link/i);
  });

  it('exposes nothing but the notice context: unknown paths are empty and prototypes are unreachable', () => {
    const html = renderTemplate('<p>[{{student.name}}][{{exam.name}}][{{admission.number}}][{{constructor.name}}][{{notice.constructor.name}}][{{school.__proto__.x}}][{{lookup notice "__proto__"}}]</p>');
    expect(html).toContain('<p>[][][][][][][]</p>');
  });

  it('refuses constructs that let a small source do unbounded work: partials, inline partials and deep nesting', () => {
    const nested = (depth: number) => `${'{{#each this}}'.repeat(depth)}x${'{{/each}}'.repeat(depth)}`;
    expect(() => assertValidNoticeTemplate(nested(NOTICE_TEMPLATE_MAX_BLOCK_DEPTH))).not.toThrow();
    expect(() => assertValidNoticeTemplate('{{#if notice.title}}a{{else}}{{#each school}}{{#with this}}{{#unless x}}b{{/unless}}{{/with}}{{/each}}{{/if}}')).not.toThrow();
    for (const source of [
      nested(NOTICE_TEMPLATE_MAX_BLOCK_DEPTH + 1),
      // Depth counts the else branch too.
      `{{#if x}}a{{else}}${nested(NOTICE_TEMPLATE_MAX_BLOCK_DEPTH)}{{/if}}`,
      // A self-calling inline partial counting with `add` is exponential work.
      '{{#*inline "p"}}{{#if (lookup "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" n)}}{{> p n=(add n 1)}}{{> p n=(add n 1)}}{{/if}}{{/inline}}{{> p n=0}}',
      '{{#if false}}{{> missing}}{{/if}}',
      '{{#> layout}}x{{/layout}}',
      '{{* decorator}}',
    ]) {
      expect(() => assertValidNoticeTemplate(source), source).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    }
  });

  it('rejects invalid syntax and unsupported helpers before a draft is saved', () => {
    expect(() => assertValidNoticeTemplate('<p>{{notice.title}}</p>')).not.toThrow();
    for (const source of ['{{#if notice.title}}', '{{unknownHelper notice.title}}', '{{> somePartial}}']) {
      expect(() => assertValidNoticeTemplate(source), source).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    }
  });
});

/**
 * Review round 1, B1/B2/B4: an author's template must not be able to make a
 * render expensive, write to the server's log, or be refused for an ordinary
 * else-if chain. The context here carries a logo as large as the server
 * accepts (5 MB of image, ~6.7 MB as a data URI).
 */
describe('hostile and ordinary author templates', () => {
  const bigLogo = `data:image/png;base64,${'A'.repeat(6_700_000)}`;
  const withBigLogo = { ...SAMPLE_NOTICE_CONTEXT, school: { ...SAMPLE_NOTICE_CONTEXT.school, logoUrl: bigLogo }, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, paragraphs: [] } };
  const render = (source: string) => renderNoticeDocument(source, withBigLogo, NOTICE_RENDER_MAX_CHARS);
  const badRequest = expect.objectContaining({ code: 'BAD_REQUEST' });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never hands the logo to the template: repeating it is refused cheaply, whatever its size', () => {
    const started = performance.now();
    for (const source of [
      // The reviewer's proofs: ~0.5 GB of output, and a 24 MB document that used to be accepted.
      '{{{school.logoUrl}}}'.repeat(9000),
      `<p>${'{{{school.logoUrl}}}'.repeat(24)}</p>`,
      // Every way of reaching the value is the same placeholder.
      `${'<img src="{{@root.school.logoUrl}}">'.repeat(2)}${'{{lookup school "logoUrl"}}'.repeat(2)}`,
      `{{#with school}}${'{{logoUrl}}'.repeat(NOTICE_MAX_LOGO_USES + 1)}{{/with}}`,
      '{{#each school}}{{#each ../school}}<img src="{{../../school.logoUrl}}">{{/each}}{{/each}}',
    ]) {
      expect(() => render(source), source.slice(0, 60)).toThrowError(badRequest);
    }
    // Refusing all of them costs far less than building one of those strings would.
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('places the real logo only after rendering, at most three times, so the size is bounded by the budget plus three logos', () => {
    const html = render(`<img src="{{school.logoUrl}}" alt="Logo"><p>{{notice.title}}</p>${'<img src="{{school.logoUrl}}">'.repeat(NOTICE_MAX_LOGO_USES - 1)}`);
    expect(html.split(bigLogo).length - 1).toBe(NOTICE_MAX_LOGO_USES);
    expect(html.length).toBeLessThan(NOTICE_RENDER_MAX_CHARS + NOTICE_MAX_LOGO_USES * bigLogo.length);
    // No placeholder is left behind.
    expect(html.replaceAll(bigLogo, '')).not.toMatch(/data:image/);
  });

  it('drops a logo the sanitizer would not keep instead of placing it', () => {
    const svg = { ...withBigLogo, school: { ...withBigLogo.school, logoUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } };
    const html = renderNoticeDocument('<img src="{{school.logoUrl}}"><p>Text</p>', svg, NOTICE_RENDER_MAX_CHARS);
    expect(html).not.toContain('svg+xml');
    expect(html).toContain('<p>Text</p>');
  });

  it('stops a multiplying template while it renders, at the notice budget', () => {
    // Four nested `each` over the school's fields run a 50 KB body a few hundred times: far over 2 MB.
    const filler = `<p>${'x'.repeat(50_000)}</p>`;
    const multiplying = `{{#each school}}{{#each ../school}}{{#each ../../school}}{{#each ../../../school}}${filler}{{/each}}{{/each}}{{/each}}{{/each}}`;
    expect(() => render(multiplying)).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('rendering limit') }));
    // The same template is refused when it is saved: one limit for the save check and for every render.
    expect(() => assertValidNoticeTemplate(multiplying)).toThrowError(badRequest);
    // A school Notice template is held to the same budget and logo limit when a template manager saves it.
    expect(() => assertValidSchoolNoticeTemplate(multiplying)).toThrowError(badRequest);
    expect(() => assertValidSchoolNoticeTemplate('{{{school.logoUrl}}}'.repeat(NOTICE_MAX_LOGO_USES + 1))).toThrowError(badRequest);
    // A flat repetition of a small value is ordinary and stays well inside the budget.
    expect(() => assertValidNoticeTemplate('<p>{{school.name}}</p>'.repeat(5_000))).not.toThrow();
  });

  it('cannot write to the server log: `log` is not a helper, and nothing reaches the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    for (const source of [
      '{{log "INJECTED LOG LINE" level="error"}}',
      '{{log school}}',
      '{{#each school}}{{log ../school.logoUrl level="error"}}{{/each}}',
      '<p>{{#if (log "x")}}a{{/if}}</p>',
    ]) {
      expect(() => assertValidNoticeTemplate(source), source).toThrowError(badRequest);
      expect(() => render(source), source).toThrowError(badRequest);
    }
    // Without arguments it is an unknown variable, which prints nothing.
    expect(render('<p>[{{log}}]</p>')).toContain('<p>[]</p>');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('accepts a long else-if chain as one level, and still refuses real nesting inside it', () => {
    const chain = (branches: number) =>
      `{{#if notice.title}}A${Array.from({ length: branches }, (_, index) => `{{else if school.x${index}}}B${index}`).join('')}{{else}}C{{/if}}`;
    expect(() => assertValidNoticeTemplate(chain(4))).not.toThrow();
    expect(() => assertValidNoticeTemplate(chain(40))).not.toThrow();
    expect(render(chain(12))).toContain('A');
    // A chain is one level: three more levels fit inside a branch, four do not.
    const inBranch = (depth: number) => `{{#if a}}A{{else if b}}${'{{#each school}}'.repeat(depth)}x${'{{/each}}'.repeat(depth)}{{else}}C{{/if}}`;
    expect(() => assertValidNoticeTemplate(inBranch(NOTICE_TEMPLATE_MAX_BLOCK_DEPTH - 1))).not.toThrow();
    expect(() => assertValidNoticeTemplate(inBranch(NOTICE_TEMPLATE_MAX_BLOCK_DEPTH))).toThrowError(badRequest);
  });
});

/**
 * Review round 2, R2B1: the budget also holds for school Notice templates
 * (which render every plain notice) and for constructs other than
 * `{{value}}`. The construct-by-construct tables are in
 * `document.render.test.ts`; these are the notice paths with the reviewer's
 * templates and a notice of the maximum length.
 */
describe('school Notice templates and the render budget', () => {
  const badRequest = expect.objectContaining({ code: 'BAD_REQUEST' });
  const longest = { ...SAMPLE_NOTICE_CONTEXT, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, paragraphs: ['y'.repeat(199_000)] } };
  let doubling = `{{#*inline "p0"}}${'x'.repeat(1_000)}{{/inline}}`;
  for (let index = 1; index <= 24; index += 1) doubling += `{{#*inline "p${index}"}}{{> p${index - 1}}}{{> p${index - 1}}}{{/inline}}`;

  it("refuses the reviewer's templates when they are saved, and bounds them if they are rendered anyway", () => {
    const before = process.memoryUsage().rss;
    const started = performance.now();
    for (const template of [
      // Accepted before: 2000 block lookups of the notice text (0.46 GB per render of a long notice).
      '<p>{{#lookup notice "paragraphs"}}{{/lookup}}</p>'.repeat(2_000),
      // Returned a 19.9 MB page against the 2 MB budget.
      '<p>{{#lookup notice "paragraphs"}}{{/lookup}}</p>'.repeat(100),
      // 4 MB accepted against the 2 MB budget; 0.5 GB allocated on the save request itself.
      `${doubling}{{> p12}}`,
      `${doubling}{{> p19}}`,
      `${doubling}{{> p24}}`,
      // An author's notice (every staff role) with the same constructs.
      '{{#lookup notice "title"}}{{/lookup}}'.repeat(5_000),
      '<img src="{{#lookup school "logoUrl"}}{{/lookup}}">'.repeat(10),
    ]) {
      expect(() => assertValidSchoolNoticeTemplate(template), template.slice(0, 50)).toThrowError(badRequest);
      expect(() => assertValidNoticeTemplate(template), template.slice(0, 50)).toThrowError(badRequest);
      // A stored copy (saved before this rule existed) cannot be rendered either, for any notice.
      expect(() => renderNoticeDocument(template, longest, NOTICE_PUBLISHED_RENDER_MAX_CHARS), template.slice(0, 50)).toThrowError(badRequest);
    }
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(process.memoryUsage().rss - before).toBeLessThan(100_000_000);
  });

  it('accepts every catalog Notice design at both print sizes, against the sample and the longest notice', () => {
    const designs = DOCUMENT_MARKETPLACE.filter((item) => item.documentType === 'notice');
    expect(designs.map((item) => item.slug)).toEqual(['notice-default', 'notice-compact']);
    for (const design of designs) {
      expect(() => assertValidSchoolNoticeTemplate(design.content), design.slug).not.toThrow();
      // Each design adapts to the size: the class it reads differs between the two renders.
      const full = renderNoticeDocument(design.content, SAMPLE_NOTICE_CONTEXT, NOTICE_RENDER_MAX_CHARS);
      const half = renderNoticeDocument(design.content, { ...SAMPLE_NOTICE_CONTEXT, print: { size: 'half' } }, NOTICE_RENDER_MAX_CHARS);
      expect(full, design.slug).toMatch(/--full"/);
      expect(half, design.slug).toMatch(/--half"/);
    }
  });

  it('checks a custom template at the print size of its own notice', () => {
    expect(() => assertValidNoticeTemplate('<p class="{{print.size}}">{{notice.title}}</p>', 'half')).not.toThrow();
  });

  it('checks a design against the longest notice when it is saved, and holds every render to the same budget', () => {
    // The built-in design prints a notice of the maximum length.
    expect(() => assertValidSchoolNoticeTemplate(defaultTemplate)).not.toThrow();
    const printsTextTimes = (times: number) => `<h1>{{notice.title}}</h1>${'{{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}'.repeat(times)}`;
    // Twice (a notice with a tear-off copy) fits; twelve times fits the sample but not a long notice.
    expect(() => assertValidSchoolNoticeTemplate(printsTextTimes(2))).not.toThrow();
    expect(() => renderNoticeDocument(printsTextTimes(12), SAMPLE_NOTICE_CONTEXT, NOTICE_RENDER_MAX_CHARS)).not.toThrow();
    expect(() => assertValidSchoolNoticeTemplate(printsTextTimes(12))).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('maximum length') }),
    );
    // Whatever was saved, the render of a real notice stops at the budget, published or not.
    for (const budget of [NOTICE_RENDER_MAX_CHARS, NOTICE_PUBLISHED_RENDER_MAX_CHARS]) {
      expect(() => renderNoticeDocument(printsTextTimes(2_000), longest, budget)).toThrowError(
        expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('rendering limit') }),
      );
    }
    // And an accepted page is never longer than the budget plus the wrapper the renderer adds.
    const html = renderNoticeDocument(printsTextTimes(2), longest, NOTICE_RENDER_MAX_CHARS);
    expect(html.length).toBeLessThan(NOTICE_RENDER_MAX_CHARS + 2_000);
  });

  it('bounds a long notice of many short paragraphs by the same budget', () => {
    const many = { ...SAMPLE_NOTICE_CONTEXT, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, paragraphs: Array.from({ length: 66_666 }, () => 'a') } };
    // The built-in design prints it.
    expect(() => renderNoticeDocument(defaultTemplate, many, NOTICE_RENDER_MAX_CHARS)).not.toThrow();
    // Loops over the paragraphs that print nothing are work too: 66,666 x 66,666 empty runs are refused.
    const started = performance.now();
    expect(() =>
      renderNoticeDocument('{{#each notice.paragraphs}}{{#each ../notice.paragraphs}}{{/each}}{{/each}}', many, NOTICE_RENDER_MAX_CHARS),
    ).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('rendering limit') }));
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

/**
 * Review round 3, R3B1: the budget bounded output but not CPU, because one
 * statement's arguments were free. The reviewer's school template took
 * ~60 s per render of a long notice at 2,000 arguments, and an author's
 * notice ~1.1 s per unsaved preview with a 32,000-pair hash. Oversized
 * calls are now refused at parse time and every allowed node is charged.
 */
describe('notice templates and CPU', () => {
  const badRequest = expect.objectContaining({ code: 'BAD_REQUEST' });
  const overBudget = expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('rendering limit') });
  const plainNotice = (paragraphs: string[]) => ({ ...SAMPLE_NOTICE_CONTEXT, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, paragraphs } });
  const hashOf = (count: number) => Array.from({ length: count }, (_, index) => `k${index.toString(36)}=a`).join(' ');
  const overParagraphs = (statement: string) =>
    `<p>{{#each notice.paragraphs}}{{#each @root.notice.paragraphs}}${statement}{{/each}}{{/each}}</p>{{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}`;
  const overRoot = (statement: string) => `${'{{#each @root}}'.repeat(4)}${statement}${'{{/each}}'.repeat(4)}`;

  it("refuses the reviewer's templates on save, quickly", () => {
    const started = performance.now();
    for (const template of [overParagraphs(`{{lookup${' a'.repeat(2_000)}}}`), overParagraphs(`{{lookup${' a'.repeat(20_000)}}}`), overParagraphs(`{{a${'.a'.repeat(20_000)}}}`)]) {
      expect(() => assertValidSchoolNoticeTemplate(template), template.slice(0, 80)).toThrowError(badRequest);
    }
    for (const template of [overRoot(`{{lookup${' a'.repeat(60_000)}}}`), overRoot(`{{lookup a "b" ${hashOf(32_000)}}}`)]) {
      expect(() => assertValidNoticeTemplate(template), template.slice(0, 80)).toThrowError(badRequest);
    }
    // Wall-clock limits are only checked off CI: shared runners are too
    // slow and noisy for them. CI still checks that each template is refused.
    if (!process.env.CI) expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('renders a maximum-size notice through the costliest school template that passes save within a small time budget', () => {
    // The most expensive statement the limits allow, run once per pair of paragraphs.
    const template = overParagraphs('{{lookup (lookup @root.notice.title "length") "x" k0=@root.notice.title k1=@root.notice.title k2=@root.notice.title k3=@root.notice.title}}');
    expect(() => assertValidSchoolNoticeTemplate(template)).not.toThrow();
    // The longest text the DTO accepts, as the most paragraphs it can hold (`a` and a blank line each).
    const longest = plainNotice(noticeParagraphs('a\n\n'.repeat(66_666)));
    expect(longest.notice.paragraphs).toHaveLength(66_666);
    for (const budget of [NOTICE_RENDER_MAX_CHARS, NOTICE_PUBLISHED_RENDER_MAX_CHARS]) {
      const started = performance.now();
      expect(() => renderNoticeDocument(template, longest, budget)).toThrowError(overBudget);
      expect(performance.now() - started).toBeLessThan(1_500);
    }
  });

  it("bounds an author's deepest allowed loops over the context to milliseconds", () => {
    const template = overRoot('{{lookup (lookup @root.school "name") "length" k0=@root.school.name k1=@root.school.name k2=@root.school.name k3=@root.school.name}}');
    const started = performance.now();
    expect(() => assertValidNoticeTemplate(template)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('the text of a rendered notice', () => {
  it('keeps the wording and drops markup, styles and images', () => {
    const html = renderTemplate('<style>.a{color:red}</style><h1>{{notice.title}}</h1><p>Bring water &amp; a cap.<br>Gates open at 8 &lt; 9.</p><ul><li>One</li><li>Two</li></ul><img src="{{school.logoUrl}}">');
    expect(noticeDocumentText(html)).toBe('Annual Sports Day\n\nBring water & a cap.\n\nGates open at 8 < 9.\n\nOne\n\nTwo');
  });
});

describe('flowing notice layout', () => {
  it('is not clipped to one sheet: no fixed height or hidden overflow, and a margin on every page', () => {
    const html = renderPlain('Text');
    expect(html).toContain('@page{size:A4;margin:16mm}');
    expect(html).toContain('class="notice-document"');
    expect(html).not.toContain('297mm');
    expect(html).not.toContain('overflow:hidden');
    expect(html).not.toContain('print-sheet');
  });

  it('starts each notice of a batch on a new page', () => {
    const one = renderDocument(defaultTemplate, SAMPLE_NOTICE_CONTEXT);
    const html = combineDocuments([one, one], 'notice');
    expect(html.match(/class="notice-document"/g)).toHaveLength(2);
    expect(html).toContain('.notice-document{box-sizing:border-box;width:100%;break-after:page');
  });

  it('lays a half-page notice out on half-A4 pages that flow, never clipped to one slot', () => {
    const one = renderDocument(defaultTemplate, { ...SAMPLE_NOTICE_CONTEXT, print: { size: 'half' } });
    const html = combineDocuments([one], 'notice', 'half');
    expect(html).toContain('@page{size:210mm 148.5mm;margin:10mm}');
    expect(html).toContain('class="notice notice--half"');
    expect(html).not.toContain('overflow:hidden');
    expect(html).not.toContain('148.5mm 148.5mm');
    expect(html).not.toContain('print-sheet');
    // The on-screen preview marks where each half page ends and says how it prints.
    expect(html).toContain('background-size:100% 128.5mm');
    expect(html).toContain('two copies per A4 sheet');
  });

  it('keeps every word of a long half-page notice: it continues on further half pages', () => {
    const paragraphs = Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1}: ${'Students must carry their identity cards. '.repeat(8)}`);
    const context = { ...SAMPLE_NOTICE_CONTEXT, print: { size: 'half' as const }, notice: { ...SAMPLE_NOTICE_CONTEXT.notice, paragraphs } };
    for (const design of DOCUMENT_MARKETPLACE.filter((item) => item.documentType === 'notice')) {
      const html = renderNoticeDocument(design.content, context, NOTICE_RENDER_MAX_CHARS);
      expect(html, design.slug).toContain('Paragraph 1:');
      expect(html, design.slug).toContain('Paragraph 60:');
      expect(html, design.slug).toContain('size:210mm 148.5mm');
      // Nothing in the layout or the design hides overflowing text or fixes a height.
      expect(html, design.slug).not.toMatch(/overflow:\s*hidden|[^-]height:\s*(?:148|297)/);
    }
  });

  it('takes the layout from the size the template was told, so design and page never disagree', () => {
    const half = renderNoticeDocument('<p class="x-{{print.size}}">{{notice.title}}</p>', { ...SAMPLE_NOTICE_CONTEXT, print: { size: 'half' } }, NOTICE_RENDER_MAX_CHARS);
    expect(half).toContain('class="x-half"');
    expect(half).toContain('size:210mm 148.5mm');
    const full = renderNoticeDocument('<p class="x-{{print.size}}">{{notice.title}}</p>', SAMPLE_NOTICE_CONTEXT, NOTICE_RENDER_MAX_CHARS);
    expect(full).toContain('class="x-full"');
    expect(full).toContain('@page{size:A4;margin:16mm}');
  });

  it('leaves every other document type on its fixed sheet', () => {
    const html = combineDocuments(['<p>One</p>'], 'report_card');
    expect(html).toContain('height:297mm;overflow:hidden');
  });
});

describe('half-page notice imposition', () => {
  const A4 = { width: 595.28, height: 841.89 };
  const HALF = A4.height / 2;

  /** A PDF with one page of each given size (as Chromium prints a half-page notice), each page labelled. */
  async function pdfOfPages(sizes: [number, number][]) {
    const pdf = await PDFDocument.create();
    sizes.forEach(([width, height], index) => pdf.addPage([width, height]).drawText(`Page ${index + 1}`, { x: 40, y: height - 40 }));
    return pdf.save();
  }
  const halfPage: [number, number] = [595.28, 420.94];

  /**
   * Review round 4, R4-3: the page count and sheet size alone would pass with
   * one copy, a crop or a wrong offset. These read the sheet's content stream
   * back: which page object it draws, how often, at what scale and where.
   */
  function expectTwoCopiesOf(imposed: PDFDocument, sheet: number, [width, height]: [number, number], expected: { scale: number }) {
    const { placements, clips } = readPdfPageDrawing(imposed, sheet);
    // No clipping path anywhere on the sheet: nothing drawn can be cut off.
    expect(clips).toBe(false);
    expect(placements).toHaveLength(2);
    const [upper, lower] = placements as [PdfPagePlacement, PdfPagePlacement];
    // Both copies draw the same embedded page object (one copy of fonts and images, two placements).
    expect(lower.object).toBe(upper.object);
    const placedWidth = width * expected.scale;
    const placedHeight = height * expected.scale;
    for (const [copy, halfBottom] of [[upper, HALF], [lower, 0]] as const) {
      // The whole source page is drawn (its bounding box is the full page, not a crop of it)…
      expect(copy.bbox).toEqual([0, 0, expect.closeTo(width, 2), expect.closeTo(height, 2)]);
      // …uniformly scaled, never enlarged…
      expect(copy.scaleX).toBeCloseTo(expected.scale, 4);
      expect(copy.scaleY).toBeCloseTo(expected.scale, 4);
      // …centred in its own half of the A4 sheet…
      expect(copy.x).toBeCloseTo((A4.width - placedWidth) / 2, 2);
      expect(copy.y).toBeCloseTo(halfBottom + (HALF - placedHeight) / 2, 2);
      // …and entirely on the sheet, inside that half.
      expect(copy.x).toBeGreaterThanOrEqual(-0.01);
      expect(copy.x + placedWidth).toBeLessThanOrEqual(A4.width + 0.01);
      expect(copy.y).toBeGreaterThanOrEqual(halfBottom - 0.01);
      expect(copy.y + placedHeight).toBeLessThanOrEqual(halfBottom + HALF + 0.01);
    }
  }

  it('prints every half page twice on one portrait A4 sheet, at full size, one copy in each half', async () => {
    const imposed = await PDFDocument.load(await imposeHalfPageNoticeCopies(await pdfOfPages([halfPage])));
    expect(imposed.getPageCount()).toBe(1);
    const { width, height } = imposed.getPage(0).getSize();
    expect(width).toBeCloseTo(A4.width, 1);
    expect(height).toBeCloseTo(A4.height, 1);
    expectTwoCopiesOf(imposed, 0, halfPage, { scale: 1 });
  });

  it('gives a long notice one sheet per half page, in order, each carrying its own page twice', async () => {
    const imposed = await PDFDocument.load(await imposeHalfPageNoticeCopies(await pdfOfPages([halfPage, halfPage, halfPage])));
    expect(imposed.getPageCount()).toBe(3);
    const drawn = imposed.getPages().map((page, sheet) => {
      expect(page.getSize().height).toBeCloseTo(A4.height, 1);
      expectTwoCopiesOf(imposed, sheet, halfPage, { scale: 1 });
      return readPdfPageDrawing(imposed, sheet).placements[0]!.object;
    });
    // Three different source pages, not the first one three times.
    expect(new Set(drawn).size).toBe(3);
  });

  it('scales a page larger than half A4 down to fit its half, centred and uncropped', async () => {
    const oversized: [number, number] = [600, 430];
    const imposed = await PDFDocument.load(await imposeHalfPageNoticeCopies(await pdfOfPages([oversized])));
    // Height is the tighter fit: 420.945 / 430.
    expectTwoCopiesOf(imposed, 0, oversized, { scale: Math.min(A4.width / 600, HALF / 430) });
    expect(readPdfPageDrawing(imposed, 0).placements[0]!.scaleX).toBeLessThan(1);
  });

  it('centres a smaller page at its own size instead of enlarging it', async () => {
    const small: [number, number] = [400, 300];
    const imposed = await PDFDocument.load(await imposeHalfPageNoticeCopies(await pdfOfPages([small])));
    expectTwoCopiesOf(imposed, 0, small, { scale: 1 });
  });
});

describe('notice PDF cache key', () => {
  it("lives under the school's prefix, so the demo purge sweep removes it", () => {
    expect(noticePdfKey('sch_1', 'ntc_1', 'full')).toBe('schools/sch_1/notices/ntc_1-full.pdf');
  });

  it('names the page size, so a PDF laid out at one size is never served for a notice of the other', () => {
    expect(noticePdfKey('sch_1', 'ntc_1', 'half')).toBe('schools/sch_1/notices/ntc_1-half.pdf');
    expect(noticePdfKey('sch_1', 'ntc_1', 'half')).not.toBe(noticePdfKey('sch_1', 'ntc_1', 'full'));
  });
});

/** Dotted leaf paths of a context object; an array is one leaf (as in `notice-template-guide.ts`). */
function leafPaths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === 'object' && !Array.isArray(child) ? leafPaths(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/** Every `{{path}}` a template reads. */
function templatePaths(source: string): string[] {
  const paths: string[] = [];
  const visitor = new Handlebars.Visitor();
  visitor.PathExpression = (path) => {
    paths.push(path.original);
  };
  visitor.accept(Handlebars.parse(source));
  return paths;
}

describe('the custom-template guide', () => {
  it('describes exactly the fields of the notice context', () => {
    expect(Object.keys(NOTICE_CONTEXT_FIELDS).sort()).toEqual(leafPaths(SAMPLE_NOTICE_CONTEXT).sort());
  });

  it('offers authors only variables the context holds, each with a value in the sample', () => {
    expect(NOTICE_TEMPLATE_VARIABLES.length).toBeGreaterThan(0);
    for (const variable of NOTICE_TEMPLATE_VARIABLES) {
      expect(variable.name).toBe(`{{${variable.path}}}`);
      // Rendered alone against the sample, an offered variable prints something.
      expect(renderDocument(`<p>${variable.name}</p>`, SAMPLE_NOTICE_CONTEXT), variable.name).not.toBe('<p></p>');
    }
    // Empty for a custom template, so it is not offered there.
    expect(NOTICE_TEMPLATE_VARIABLES.map((variable) => variable.path)).not.toContain('notice.paragraphs');
  });

  it('starts a custom template from a document that is valid and reads offered variables only', () => {
    expect(() => assertValidNoticeTemplate(NOTICE_TEMPLATE_STARTER)).not.toThrow();
    const offered = NOTICE_TEMPLATE_VARIABLES.map((variable) => variable.path as string);
    const used = templatePaths(NOTICE_TEMPLATE_STARTER);
    expect(used.length).toBeGreaterThan(0);
    for (const path of used) expect(offered, path).toContain(path);
    const html = renderTemplate(NOTICE_TEMPLATE_STARTER);
    expect(html).toContain(SAMPLE_NOTICE_CONTEXT.school.name);
    expect(html).toContain(SAMPLE_NOTICE_CONTEXT.notice.title);
    expect(html).toContain(SAMPLE_NOTICE_CONTEXT.notice.issuedOnDisplay);
  });
});
