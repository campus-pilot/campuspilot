import { afterEach, describe, expect, it, vi } from 'vitest';

import Handlebars from 'handlebars';

import { DOCUMENT_MARKETPLACE, sampleDocumentContext } from './document.catalog';
import {
  combineDocuments,
  convertDocumentPdf,
  DOCUMENT_RENDER_MAX_CHARS,
  DOCUMENT_TEMPLATE_BLOCK_HELPERS,
  DOCUMENT_TEMPLATE_STRUCTURE_LIMITS,
  DOCUMENT_TEMPLATE_HELPERS,
  measureDocumentRender,
  registeredDocumentHelpers,
  registeredDocumentPartialsAndDecorators,
  renderDocument,
  renderDocuments,
} from './document.render';

describe('document rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders values with a restrictive CSP and HTML escaping', () => {
    const html = renderDocument('<h1>{{name}}</h1>', {
      name: '<script>unsafe()</script>',
    });

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(
      '&lt;script&gt;unsafe()&lt;/script&gt;',
    );
    expect(html).not.toContain('<script>');
  });

  it('removes active markup, event handlers, and external images', () => {
    const html = renderDocument(
      '<script>alert(1)</script><p onclick="alert(2)">Safe</p><img src="https://example.com/a.png">',
      {},
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('https://example.com');
    expect(html).toContain('<p>Safe</p>');
  });

  it.each(['png', 'jpeg', 'webp'])(
    'retains a base64 %s data image',
    (format) => {
      const html = renderDocument(
        `<img src="data:image/${format};base64,AAAA" alt="Photo">`,
        {},
      );

      expect(html).toContain(`data:image/${format};base64,AAAA`);
      expect(html).toContain('alt="Photo"');
    },
  );

  it('supports the bounded numeric add helper', () => {
    expect(renderDocument('{{add columns 1}}', { columns: 3 })).toContain(
      '<body>4</body>',
    );
  });

  it.each([
    ['{{add value 1}}', { value: '3' }],
    ['{{add value 1}}', { value: Number.POSITIVE_INFINITY }],
    ['{{unknown value}}', { value: 1 }],
  ])('maps invalid or unsupported templates to BAD_REQUEST', (template, context) => {
    expect(() => renderDocument(template, context)).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'The template contains invalid Handlebars syntax or an unsupported helper.',
      }),
    );
  });

  it('says on which line the syntax is invalid, without echoing the source', () => {
    for (const [template, line] of [['{{#if value}}', 1], ['<p>\n\n{{#each list}}x{{/if}}', 3], ['a\n{{name bar=}}', 2]] as const) {
      expect(() => renderDocument(template, {}), template).toThrowError(
        expect.objectContaining({ code: 'BAD_REQUEST', message: `The template has invalid Handlebars syntax on line ${line}.` }),
      );
    }
  });

  it('registers exactly the documented helpers: an allowlist, so `log` and any future built-in are refused', () => {
    expect(registeredDocumentHelpers()).toEqual(
      [...DOCUMENT_TEMPLATE_HELPERS, '__documentOutput', '__documentRawOutput', '__documentRun', 'blockHelperMissing', 'helperMissing'].sort(),
    );
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    for (const template of ['{{log "x"}}', '{{log value level="error"}}', '{{#each list}}{{log this}}{{/each}}']) {
      expect(() => renderDocument(template, { value: 1, list: [1, 2] }), template).toThrowError(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // No decorator (`inline` defines inline partials) and no partial exists on the instance.
    expect(registeredDocumentPartialsAndDecorators()).toEqual([]);
    for (const name of DOCUMENT_TEMPLATE_BLOCK_HELPERS) expect(DOCUMENT_TEMPLATE_HELPERS).toContain(name);
  });

  it('stops a template that multiplies a large value while it renders, not after', () => {
    const photo = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const students = Array.from({ length: 40 }, () => ({ photo }));
    // 40 x 40 x 1 MB = 1.6 GB if it were allowed to finish.
    const started = performance.now();
    expect(() =>
      renderDocument('{{#each students}}{{#each ../students}}<img src="{{photo}}">{{/each}}{{/each}}', { students }),
    ).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('rendering limit') }));
    // Outside any block too.
    expect(() => renderDocument('{{{photo}}}'.repeat(30), { photo })).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('counts each character once: a legitimate large document renders, with conditions, sections and nesting', () => {
    const photo = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const students = Array.from({ length: 15 }, (_, index) => ({ name: `Student ${index}`, photo }));
    // 15 MB of photos read by an `if`, printed inside nested blocks: under the 25 MB ceiling.
    const html = renderDocument(
      '{{#each students}}{{#with this}}{{#if photo}}<p>{{name}}</p><img src="{{photo}}">{{/if}}{{/with}}{{/each}}{{#students}}<i>{{name}}</i>{{/students}}',
      { students },
    );
    expect(html.split(photo).length - 1).toBe(15);
    expect(html).toContain('<i>Student 14</i>');
    // A lower ceiling is honoured exactly: 3 KB of output fits 4 KB and not 2 KB.
    const text = 'x'.repeat(1_000);
    expect(() => renderDocument('{{a}}{{a}}{{a}}', { a: text }, { maxOutputChars: 4_000 })).not.toThrow();
    expect(() => renderDocument('{{a}}{{a}}{{a}}', { a: text }, { maxOutputChars: 2_000 })).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });

  it('keeps expressions, escaping and whitespace control unchanged by the output meter', () => {
    const html = renderDocument(
      '<p>{{name}}|{{{raw}}}|{{lookup map "key"}}|{{add n 1}}|{{#each list}}{{@index}}:{{this}}{{#unless @last}},{{/unless}}{{/each}}|  {{~tight~}}  |{{missing}}|{{#if missing}}no{{else}}yes{{/if}}</p>',
      { name: 'A & B', raw: '<b>bold</b>', map: { key: 'value' }, n: 2, list: ['x', 'y'], tight: 'T' },
    );
    expect(html).toContain('<p>A &amp; B|<b>bold</b>|value|3|0:x,1:y|T||yes</p>');
  });

  it('uses an A4 grid for ID card batches', () => {
    const html = combineDocuments(['<p>One</p>', '<p>Two</p>'], 'id_card');

    expect(html).toContain('@page{size:A4;');
    expect(html).toContain('grid-template-columns:86mm 86mm');
    expect(html.match(/class="sheet-item"/g)).toHaveLength(2);
  });

  it('packs half-A4 templates two-up and starts the third document on a new sheet', () => {
    const html = combineDocuments(
      ['<p>One</p>', '<p>Two</p>', '<p>Three</p>'],
      'receipt',
      'half',
    );

    expect(html).toContain('grid-template-rows:148.5mm 148.5mm');
    expect(html.match(/class="print-sheet"/g)).toHaveLength(2);
    expect(html.match(/class="sheet-item"/g)).toHaveLength(3);
  });

  it('uses landscape pages for timetables and page breaks for reports', () => {
    expect(combineDocuments(['Timetable'], 'timetable')).toContain(
      '@page{size:A4 landscape;',
    );
    expect(combineDocuments(['Report'], 'report_card')).toContain(
      'break-after:page',
    );
  });

  it('sanitizes each document while combining a batch', () => {
    const html = combineDocuments(
      ['<p onclick="unsafe()">Safe</p><script>unsafe()</script>'],
      'report_card',
    );

    expect(html).toContain('<p>Safe</p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
  });

  it('rejects batches beyond the rendering byte limit before wrapping them', () => {
    expect(() =>
      combineDocuments(['x'.repeat(25_000_001)], 'report_card'),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'This document exceeds the 25 MB rendering limit. Select fewer students or use smaller photos.',
      }),
    );
  });

  it.each([
    ['timetable', '11.7', '8.27'],
    ['report_card', '8.27', '11.7'],
  ] as const)(
    'sends %s HTML to the converter with the intended paper orientation',
    async (type, width, height) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('%PDF-1.7\nvalid', { status: 200 }),
      );

      await expect(convertDocumentPdf('<p>Document</p>', type)).resolves.toEqual(
        Buffer.from('%PDF-1.7\nvalid'),
      );
      const [, init] = fetchMock.mock.calls[0]!;
      const form = init?.body as FormData;
      expect(form.get('paperWidth')).toBe(width);
      expect(form.get('paperHeight')).toBe(height);
      expect(form.get('preferCssPageSize')).toBe('true');
      expect(form.get('printBackground')).toBe('true');
      expect(form.get('files')).toBeInstanceOf(Blob);
    },
  );

  it('rejects failed and malformed converter responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('unavailable', { status: 503 }),
    );
    await expect(
      convertDocumentPdf('<p>Document</p>', 'report_card'),
    ).rejects.toThrow('PDF conversion failed (503).');

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('not a pdf', { status: 200 }),
    );
    await expect(
      convertDocumentPdf('<p>Document</p>', 'report_card'),
    ).rejects.toThrow('PDF converter returned an invalid or oversized document.');
  });
});

/**
 * Review round 2, R2B1. The render budget is a design rule, not a list of
 * patched helpers: every Handlebars construct that can produce output is
 * either counted while it is produced or refused when the template is
 * parsed. These tables hold one row per construct; a new construct belongs
 * in exactly one of them.
 */
describe('render budget: every output-producing construct is counted or refused', () => {
  // The lexer spies below must not outlive their test: a later Handlebars.parse would never end.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Plain Handlebars with the same `add` helper: what a template means without any accounting. */
  const reference = Handlebars.create();
  reference.registerHelper('add', (a: unknown, b: unknown) => {
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) throw new Error('add requires finite numbers');
    return a + b;
  });
  const badRequest = expect.objectContaining({ code: 'BAD_REQUEST' });
  const overBudget = expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringContaining('rendering limit') });

  const context = {
    name: 'A & "B" <c>',
    html: '<b>bold</b>',
    n: 2,
    zero: 0,
    flag: true,
    off: false,
    nul: null,
    text: 'T',
    list: ['x', 'y', 'z'],
    empty: [] as string[],
    keys: ['key'],
    map: { key: 'value', other: '<o>' },
    nested: { deep: { value: 'D' } },
    rows: [
      { name: 'r1', cells: [1, 2] },
      { name: 'r2', cells: [3] },
    ],
  };

  /** [construct, template]: each must render exactly as plain Handlebars does and be counted to the character. */
  const counted: [string, string][] = [
    ['static text', '<p>plain &amp; simple</p>'],
    ['comments', 'a{{! short }}b{{!-- long {{x}} --}}c'],
    ['escaped mustache', '<p>{{name}}</p>'],
    ['triple mustache', '<p>{{{html}}}|{{{name}}}</p>'],
    ['ampersand mustache', '<p>{{&html}}</p>'],
    ['numbers, booleans, null and missing values', '[{{n}}][{{zero}}][{{flag}}][{{off}}][{{nul}}][{{missing}}][{{{zero}}}][{{{off}}}][{{{nul}}}][{{{missing}}}]'],
    ['arrays and objects printed whole', '[{{list}}][{{{list}}}][{{map}}][{{{map}}}][{{empty}}]'],
    ['dotted, this, ./ and segment-literal paths', '{{nested.deep.value}}|{{this.name}}|{{./name}}|{{[name]}}|{{nested.[deep].value}}'],
    ['literal mustaches are lookups', '[{{"name"}}][{{1}}][{{true}}]'],
    ['lookup and add as expressions', '{{lookup map "key"}}|{{lookup list 1}}|{{add n 1}}|{{{lookup map "other"}}}'],
    ['sub-expressions', '{{add (add n 1) 2}}|{{lookup map (lookup keys 0)}}|{{#if (lookup map "key")}}yes{{/if}}'],
    ['each over an array with @data', '{{#each list}}{{@index}}{{@first}}{{@last}}{{@key}}:{{this}};{{/each}}'],
    ['each over an object', '{{#each map}}{{@key}}={{this}};{{/each}}'],
    ['each with an inverse', '{{#each empty}}x{{else}}none{{/each}}|{{#each missing}}x{{else}}none{{/each}}'],
    ['each with block params', '{{#each list as |item position|}}{{position}}:{{item}};{{/each}}'],
    ['nested each with parent paths and @root', '{{#each rows}}{{#each cells}}{{../name}}:{{this}}:{{@../index}}:{{@root.text}};{{/each}}{{/each}}'],
    ['a block param named like a helper', '{{#each list as |add|}}{{add}}{{/each}}'],
    ['if, else and unless', '{{#if flag}}a{{else}}b{{/if}}{{#if off}}a{{else}}b{{/if}}{{#unless off}}c{{/unless}}{{#unless flag}}c{{else}}d{{/unless}}'],
    ['else-if chains', '{{#if off}}a{{else if zero}}b{{else if flag}}c{{else}}d{{/if}}'],
    ['hash arguments', '{{#if zero includeZero=true}}zero counts{{/if}}'],
    ['with, its inverse and its block param', '{{#with nested.deep}}{{value}}{{/with}}{{#with missing}}x{{else}}none{{/with}}{{#with nested as |n|}}{{n.deep.value}}{{/with}}'],
    ['sections on an array, a boolean, an object and a string', '{{#list}}{{this}}{{/list}}{{#flag}}yes{{/flag}}{{#map}}{{key}}{{/map}}{{#text}}{{.}}{{/text}}{{#nested.deep}}{{value}}{{/nested.deep}}'],
    ['sections with an inverse and inverted sections', '{{#off}}a{{else}}b{{/off}}{{^off}}c{{/off}}{{^flag}}d{{else}}e{{/flag}}{{#empty}}x{{^}}f{{/empty}}'],
    ['raw blocks', 'a{{{{raw}}}}{{name}}{{{{/raw}}}}b'],
    ['escaped braces', 'a \\{{name}} b'],
    ['whitespace control', 'a  {{~name~}}  b  {{~#if flag~}}  c  {{~/if~}}  d'],
    ['standalone block lines', '<ul>\n  {{#each list}}\n  <li>{{this}}</li>\n  {{/each}}\n</ul>\n{{#if off}}\n  no\n{{else}}\n  yes\n{{/if}}\n\n\nend\n'],
    ['standalone else-if lines', '{{#if off}}\n a\n{{else if flag}}\n b\n{{else}}\n c\n{{/if}}\n'],
    ['empty blocks', '{{#each list}}{{/each}}{{#if flag}}{{/if}}[{{#if off}}{{/if}}]'],
  ];

  it.each(counted)('counts %s exactly and leaves its meaning unchanged', (_construct, template) => {
    const expected = reference.compile(template)(context);
    const measured = measureDocumentRender(template, context);
    expect(measured.raw).toBe(expected);
    // The accounting is exact: no character is produced without being counted.
    expect(measured.chars).toBe(expected.length);
    // And the budget is that count plus one step per body run: one unit less is refused.
    const needed = measured.chars + measured.steps;
    expect(() => measureDocumentRender(template, context, needed)).not.toThrow();
    expect(() => measureDocumentRender(template, context, needed - 1)).toThrowError(overBudget);
  });

  it('holds every counted construct to the budget when it multiplies a large value', () => {
    const big = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const quotes = '"'.repeat(400_000);
    const hostile = { big, quotes, school: { logoUrl: big, name: 'S' }, list: Array.from({ length: 40 }, () => big), people: Array.from({ length: 300 }, (_, index) => index) };
    const limit = 3_000_000;
    const before = process.memoryUsage().rss;
    const started = performance.now();
    for (const template of [
      '{{big}}'.repeat(400),
      '{{{big}}}'.repeat(400),
      '{{&big}}'.repeat(400),
      '{{lookup school "logoUrl"}}'.repeat(400),
      '{{{lookup (lookup this "school") "logoUrl"}}}'.repeat(400),
      '{{#each list}}{{this}}{{/each}}'.repeat(10),
      '{{#each list as |value|}}{{#each ../list}}{{{value}}}{{/each}}{{/each}}',
      '{{#each list}}{{#each @root.list}}{{{@root.school.logoUrl}}}{{/each}}{{/each}}',
      '{{#list}}{{.}}{{/list}}'.repeat(10),
      '{{#school.logoUrl}}{{.}}{{/school.logoUrl}}'.repeat(400),
      '{{#with school}}{{logoUrl}}{{/with}}'.repeat(400),
      '{{#if missing}}{{else}}{{{big}}}{{/if}}'.repeat(400),
      '{{^missing}}{{{big}}}{{/missing}}'.repeat(400),
      '{{#if missing}}{{else if big}}{{{big}}}{{/if}}'.repeat(400),
      // Escaping multiplies by six: counted after escaping (400 KB of quotes are 2.4 MB of output).
      '{{quotes}}{{quotes}}',
      // Static text in a loop.
      `{{#each people}}{{#each ../people}}${'x'.repeat(1_000)}{{/each}}{{/each}}`,
      // Loops that print nothing still end: 300^3 runs of an empty body.
      '{{#each people}}{{#each ../people}}{{#each ../../people}}{{/each}}{{/each}}{{/each}}',
    ]) {
      expect(() => measureDocumentRender(template, hostile, limit), template.slice(0, 70)).toThrowError(overBudget);
    }
    // All of them together cost far less than one of them would if it ran to the end (0.4 GB and more).
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(process.memoryUsage().rss - before).toBeLessThan(200_000_000);
    // What is accepted is never longer than the budget.
    const accepted = measureDocumentRender('{{{big}}}{{{big}}}', hostile, limit);
    expect(accepted.raw.length).toBeLessThanOrEqual(limit);
  });

  it('charges the work of expressions that print nothing, so a loop of them ends early', () => {
    const people = Array.from({ length: 300 }, (_, index) => index);
    // 300^2 runs of 5,000 empty lookups each would be 450 million evaluations.
    const template = `{{#each people}}{{#each ../people}}${'{{missing}}'.repeat(5_000)}{{/each}}{{/each}}`;
    const started = performance.now();
    expect(() => measureDocumentRender(template, { people }, 3_000_000)).toThrowError(overBudget);
    // About 0.9 s alone; the bound leaves room for a loaded machine running files in parallel,
    // and is still far below the minutes the 450 million evaluations would take.
    expect(performance.now() - started).toBeLessThan(5_000);
    // One run of a body costs one step plus the expression nodes of its statements.
    const measured = measureDocumentRender('a{{x}}{{#if x}}b{{/if}}', { x: 'y' });
    // The template: one run, `x` (one node) and `if x` (two); the if body: one run, no statements.
    expect(measured.steps).toBe(1 + 1 + 2 + 1);
    // A call costs its head, arguments, hash values and path parts: `lookup a.b "c"` is 1 + 2 + 1.
    expect(measureDocumentRender('{{lookup a.b "c"}}', {}).steps).toBe(1 + 4);
    expect(measureDocumentRender('{{add (add n 1) 2 k=n}}', { n: 1 }).steps).toBe(1 + (1 + (1 + 1 + 1) + 1 + 1));
  });

  /**
   * Review round 3, R3B1: a statement's arguments used to be free, so one
   * `{{lookup a a … a}}` with 60,000 arguments (or 30,000 hash pairs, or a
   * path of 20,000 parts) inside nested loops cost tens of thousands of
   * evaluations per run while being charged two steps. Such calls are now
   * refused when the template is parsed, and every node that is allowed is
   * charged on every run.
   */
  describe('expression limits (CPU)', () => {
    const limits = DOCUMENT_TEMPLATE_STRUCTURE_LIMITS;
    /** A refusal for a structural limit (not a render error of a helper given odd arguments). */
    const overLimit = expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringMatching(/at most|too complex|too many/) });
    const nested = (body: string) => `{{#each l}}{{#each @root.l}}${body}{{/each}}{{/each}}`;
    const hashOf = (count: number) => Array.from({ length: count }, (_, index) => `k${index}=a`).join(' ');
    /** `with`, an inverted section, `count` × `each` and a raw block inside them: `count` + 3 levels. */
    const mixedNesting = (count: number) =>
      `{{#with a}}{{^a}}${'{{#each a}}'.repeat(count)}{{{{raw}}}}x{{{{/raw}}}}${'{{/each}}'.repeat(count)}{{/a}}{{/with}}`;
    const subOf = (depth: number) => `${'(add '.repeat(depth)}1${' 1)'.repeat(depth)}`;

    /** [limit, template within it, template one past it]. */
    const edges: [string, string, string][] = [
      ['arguments', `{{lookup${' a'.repeat(limits.params)}}}`, `{{lookup${' a'.repeat(limits.params + 1)}}}`],
      ['arguments of a block', `{{#if${' a'.repeat(limits.params)}}}x{{/if}}`, `{{#if${' a'.repeat(limits.params + 1)}}}x{{/if}}`],
      ['arguments of a sub-expression', `{{lookup (lookup${' a'.repeat(limits.params)}) "b"}}`, `{{lookup (lookup${' a'.repeat(limits.params + 1)}) "b"}}`],
      ['hash pairs', `{{lookup a "b" ${hashOf(limits.hashPairs)}}}`, `{{lookup a "b" ${hashOf(limits.hashPairs + 1)}}}`],
      ['hash pairs of a block', `{{#if a ${hashOf(limits.hashPairs)}}}x{{/if}}`, `{{#if a ${hashOf(limits.hashPairs + 1)}}}x{{/if}}`],
      ['path parts', `{{a${'.a'.repeat(limits.pathParts - 1)}}}`, `{{a${'.a'.repeat(limits.pathParts)}}}`],
      ['path parts of an argument', `{{lookup a${'.a'.repeat(limits.pathParts - 1)} "b"}}`, `{{lookup a${'.a'.repeat(limits.pathParts)} "b"}}`],
      ['sub-expression depth', `{{add ${subOf(limits.subExpressionDepth)} 1}}`, `{{add ${subOf(limits.subExpressionDepth + 1)} 1}}`],
      // Four arguments of four path parts each, then one more argument's worth of nodes.
      ['nodes in one statement', `{{lookup (lookup a.a.a.a a.a.a.a a.a.a.a) a.a.a.a a.a.a.a a.a.a.a}}`, `{{lookup (lookup a.a.a.a a.a.a.a a.a.a.a a.a.a.a) (lookup a.a.a.a a.a.a.a a.a.a.a) a.a.a.a a.a.a.a}}`],
      ['nodes in a template', '{{a}}'.repeat(limits.templateNodes), '{{a}}'.repeat(limits.templateNodes + 1)],
      ['block nesting', `${'{{#if a}}'.repeat(limits.blockNesting)}x${'{{/if}}'.repeat(limits.blockNesting)}`, `${'{{#if a}}'.repeat(limits.blockNesting + 1)}x${'{{/if}}'.repeat(limits.blockNesting + 1)}`],
      ['an else-if chain', `{{#if a}}x${'{{else if a}}x'.repeat(limits.blockNesting - 1)}{{/if}}`, `{{#if a}}x${'{{else if a}}x'.repeat(limits.blockNesting)}{{/if}}`],
      ['nesting of every block kind', mixedNesting(limits.blockNesting - 3), mixedNesting(limits.blockNesting - 2)],
    ];

    it.each(edges)('accepts %s up to the limit and refuses one more at parse time', (_limit, within, past) => {
      // Within the limit the template is not refused for it (a helper given more arguments than it reads may still fail at render).
      expect(() => measureDocumentRender(within, {})).not.toThrowError(overLimit);
      expect(() => measureDocumentRender(past, {})).toThrowError(overLimit);
    });

    it('limits nesting before the parser runs, so deep nesting is refused in linear time', () => {
      const started = performance.now();
      // 200 KB each, the template size limit. Handlebars' parser alone needs 2.6 s for 4,000 nested
      // sub-expressions and 2 s for 4,000 nested blocks, and grows faster than the square.
      for (const template of [
        `{{lookup a ${'(add '.repeat(25_000)}1${' 1)'.repeat(25_000)}}}`,
        `${'{{#if a}}'.repeat(12_000)}x${'{{/if}}'.repeat(12_000)}`,
        `{{#if a}}x${'{{else if a}}x'.repeat(14_000)}{{/if}}`,
        `${'{{^a}}'.repeat(25_000)}x`,
      ]) {
        expect(() => measureDocumentRender(template, {}), template.slice(0, 30)).toThrowError(overLimit);
      }
      expect(performance.now() - started).toBeLessThan(2_000);
      // Unbalanced input is left to the parser, which reports it as invalid syntax.
      expect(() => measureDocumentRender('{{/if}}{{/if}}{{#if a}}', {})).toThrowError(badRequest);
      expect(() => measureDocumentRender('{{lookup a ))}}', {})).toThrowError(badRequest);
    });

    /**
     * Review round 4, R4-1: the lexer returns the closing `{{{{/raw}}}}` as the
     * token *name* `'END_RAW_BLOCK'`, not its id, and the scan used to stop at
     * the first non-numeric token, so anything after a raw block reached the
     * parser unchecked (108 KB of nested sub-expressions parsed for 25 s).
     * Every lexer state that can come before deep nesting is covered here:
     * the scan must read past it and refuse in linear time.
     */
    describe('nesting after other lexer states', () => {
      const deepBlocks = `${'{{#if a}}'.repeat(4_000)}x${'{{/if}}'.repeat(4_000)}`;
      const deepSubExpressions = `{{lookup a ${'(lookup '.repeat(12_000)}a${')'.repeat(12_000)}}}`;
      const longElseIfChain = `{{#if a}}x${'{{else if a}}x'.repeat(limits.blockNesting)}{{/if}}`;
      /** [state, prefix that leaves the lexer in its normal state again]. */
      const prefixes: [string, string][] = [
        ['an empty raw block', '{{{{raw}}}}{{{{/raw}}}}'],
        ['a raw block with nesting in its body', `{{{{raw}}}}${'{{#if a}}'.repeat(100)}{{{{/raw}}}}`],
        ['a raw block with a nested raw opener in its body', '{{{{raw}}}}{{{{raw}}}}x{{{{/raw}}}}{{{{/raw}}}}'],
        ['two raw blocks', '{{{{raw}}}}x{{{{/raw}}}}{{{{raw}}}}y{{{{/raw}}}}'],
        ['a comment', '{{!-- {{#if a}} {{{{/raw}}}} --}}'],
        ['a short comment', '{{! note }}'],
        ['a string literal', '{{lookup a "}}{{{{/raw}}}}{{#if a}}"}}'],
        ['an escaped mustache', '\\{{#if a}}'],
        ['an escaped raw block', '\\{{{{raw}}}}{{{{/raw}}}}'],
      ];
      const payloads: [string, string][] = [
        ['blocks', deepBlocks],
        ['sub-expressions', deepSubExpressions],
        ['an else-if chain', longElseIfChain],
      ];
      const cases = prefixes.flatMap(([state, prefix]) =>
        payloads.map(([payload, body]) => [state, payload, prefix + body] as const),
      );

      it.each(cases)('after %s, refuses deep %s before parsing', (_state, _payload, template) => {
        const started = performance.now();
        expect(() => measureDocumentRender(template, {})).toThrowError(overLimit);
        // The parser alone needs seconds for these; the scan is linear.
        expect(performance.now() - started).toBeLessThan(250);
      });

      it('accepts legal nesting after a raw block, and a raw block between blocks', () => {
        const legal = `{{{{raw}}}}{{{{/raw}}}}${'{{#if a}}'.repeat(limits.blockNesting)}x${'{{/if}}'.repeat(limits.blockNesting)}`;
        expect(() => measureDocumentRender(legal, { a: true })).not.toThrow();
        // The raw block closes its level: 63 blocks + a raw block inside them, then 64 more after it.
        const around = `${'{{#if a}}'.repeat(limits.blockNesting - 1)}{{{{raw}}}}x{{{{/raw}}}}${'{{/if}}'.repeat(limits.blockNesting - 1)}${'{{#if a}}'.repeat(limits.blockNesting)}y${'{{/if}}'.repeat(limits.blockNesting)}`;
        expect(() => measureDocumentRender(around, { a: true })).not.toThrow();
      });

      it('leaves input after an invalid token or a lexical error to the parser, which fails there', () => {
        const started = performance.now();
        // `INVALID` (an unterminated string) and an unterminated comment: the parser stops at the same point.
        expect(() => measureDocumentRender(`{{a "x${deepBlocks}`, {})).toThrowError(badRequest);
        expect(() => measureDocumentRender(`${'{{#if a}}'.repeat(10)}{{!-- open ${deepBlocks}`, {})).toThrowError(badRequest);
        expect(() => measureDocumentRender(`{{{{raw}}}} unclosed ${deepBlocks}`, {})).toThrowError(badRequest);
        expect(performance.now() - started).toBeLessThan(250);
      });

      it('refuses a template whose tokens the scan cannot classify, or that it cannot finish', () => {
        const unsupported = expect.objectContaining({ code: 'BAD_REQUEST', message: expect.stringMatching(/not supported/) });
        const lexer = (Handlebars as unknown as { Parser: { lexer: { lex(): number | string } } }).Parser.lexer;
        // A token name outside the grammar, and an id outside it.
        vi.spyOn(lexer, 'lex').mockReturnValue('NOT_A_TOKEN');
        expect(() => measureDocumentRender('{{a}}', {})).toThrowError(unsupported);
        vi.spyOn(lexer, 'lex').mockReturnValue(9_999);
        expect(() => measureDocumentRender('{{a}}', {})).toThrowError(unsupported);
        // A lexer that never reaches the end: the guard refuses instead of handing unchecked input on.
        vi.spyOn(lexer, 'lex').mockReturnValue(15);
        expect(() => measureDocumentRender('{{a}}', {})).toThrowError(unsupported);
      });
    });

    it('stays far above what every marketplace design uses', () => {
      // The marketplace test above renders each design; this pins the margin.
      const widest = { params: 0, hashPairs: 0, pathParts: 0 };
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const value = node as { type?: string; params?: unknown[]; hash?: { pairs: unknown[] }; parts?: unknown[] };
        if (Array.isArray(value.params)) widest.params = Math.max(widest.params, value.params.length);
        if (value.hash) widest.hashPairs = Math.max(widest.hashPairs, value.hash.pairs.length);
        if (value.type === 'PathExpression' && value.parts) widest.pathParts = Math.max(widest.pathParts, value.parts.length);
        for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
      };
      for (const item of DOCUMENT_MARKETPLACE) visit(Handlebars.parse(item.content));
      expect(widest.params * 2).toBeLessThanOrEqual(limits.params);
      expect(widest.hashPairs).toBeLessThan(limits.hashPairs);
      expect(widest.pathParts * 2).toBeLessThanOrEqual(limits.pathParts);
    });

    it("refuses the reviewer's statements quickly, before running them", () => {
      const list = { l: Array.from({ length: 100 }, () => 1) };
      const started = performance.now();
      for (const template of [
        nested(`{{lookup${' a'.repeat(60_000)}}}`),
        nested(`{{lookup a "b" ${hashOf(32_000)}}}`),
        nested(`{{a${'.a'.repeat(20_000)}}}`),
        nested(`{{#if a ${hashOf(32_000)}}}{{/if}}`),
        nested(`{{lookup a ${subOf(5_000)}}}`),
      ]) {
        expect(() => measureDocumentRender(template, list), template.slice(0, 40)).toThrowError(badRequest);
      }
      // Wall-clock limits are only checked off CI: shared runners are too
      // slow and noisy for them. CI still checks that each template is refused.
      if (!process.env.CI) expect(performance.now() - started).toBeLessThan(2_000);
    });

    it('bounds the time of the most expensive statements the limits allow by the budget', () => {
      const people = { people: Array.from({ length: 2_000 }, (_, index) => index), a: { a: { a: { a: 1 } } } };
      const loops = (body: string) => `{{#each people}}{{#each @root.people}}{{#each @root.people}}${body}{{/each}}{{/each}}{{/each}}`;
      const heaviest = [
        loops(''),
        loops('{{@root.a.a.a.a}}'),
        loops('{{lookup (lookup @root.a.a.a "a") "a" k0=@root.a.a.a k1=@root.a.a.a k2=@root.a.a.a k3=@root.a.a.a}}'),
        loops('{{#if @root.a.a.a.a k0=@root.a k1=@root.a k2=@root.a k3=@root.a}}{{/if}}'),
      ];
      // 2,000^3 runs each if nothing stopped them; the notice budget stops each in tens of milliseconds.
      const started = performance.now();
      for (const template of heaviest)
        expect(() => measureDocumentRender(template, people, 2_000_000), template.slice(-60)).toThrowError(overBudget);
      expect(performance.now() - started).toBeLessThan(2_000);
    });
  });

  /** [construct, template]: refused when the template is parsed, with or without a large value in the context. */
  const refused: [string, string][] = [
    ['a partial', '{{> name}}'],
    ['a partial inside a branch that never runs', '{{#if false}}{{> name}}{{/if}}'],
    ['a dynamic partial', '{{> (lookup . "text")}}'],
    ['a partial block', '{{#> layout}}x{{/layout}}'],
    ['an inline partial', '{{#*inline "p"}}x{{/inline}}'],
    ['an inline partial that is used', '{{#*inline "p"}}{{{big}}}{{/inline}}{{> p}}{{> p}}'],
    ['a decorator', '{{* decorator}}'],
    ['lookup as a block', '{{#lookup school "logoUrl"}}{{/lookup}}'],
    ['lookup as a block with an inverse', '{{#lookup school "logoUrl"}}a{{else}}b{{/lookup}}'],
    ['lookup as a block, spelled as a literal', '{{#"lookup" school "logoUrl"}}{{/lookup}}'],
    ['lookup as a block, spelled as data', '{{#@lookup school "logoUrl"}}{{/@lookup}}'],
    ['lookup as a block, spelled with a longer path', '{{#lookup.x school "logoUrl"}}{{/lookup.x}}'],
    ['lookup as a block without arguments', '{{#lookup}}{{/lookup}}'],
    ['add as a block', '{{#add 1 2}}{{/add}}'],
    ['the missing-helper hook as a block', '{{#helperMissing}}{{/helperMissing}}'],
    ['the section hook called by name', '{{#blockHelperMissing big}}{{/blockHelperMissing}}'],
    ['the accounting helpers by name', '{{__documentRun 5}}'],
    ['the accounting helpers as a literal', '{{"__documentRun" -5000000}}'],
    ['the accounting helpers as data', '{{@__documentRawOutput big}}'],
    ['the accounting helpers as a block', '{{#__documentOutput big}}{{/__documentOutput}}'],
    ['the accounting helpers in a sub-expression', '{{lookup (__documentRawOutput big) "length"}}'],
    ['the accounting helpers as an argument', '{{lookup __documentRun "x"}}'],
  ];

  it.each(refused)('refuses %s at parse time', (_construct, template) => {
    const big = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const hostile = { big, text: 'name', school: { logoUrl: big } };
    const before = process.memoryUsage().rss;
    // Repeated 400 times it would print 400 MB if any of them reached the value.
    expect(() => renderDocument(template.repeat(400), hostile), template).toThrowError(badRequest);
    expect(() => renderDocument(template, {}), template).toThrowError(badRequest);
    expect(process.memoryUsage().rss - before).toBeLessThan(100_000_000);
  });

  it("refuses the reviewer's templates for school documents without building their output", () => {
    const big = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const hostile = { student: { photoUrl: big }, school: { logoUrl: big, name: 'S' } };
    let doubling = `{{#*inline "p0"}}${'x'.repeat(1_000)}{{/inline}}`;
    for (let index = 1; index <= 24; index += 1) doubling += `{{#*inline "p${index}"}}{{> p${index - 1}}}{{> p${index - 1}}}{{/inline}}`;
    const before = process.memoryUsage().rss;
    const started = performance.now();
    for (const template of [
      // 24 MB that used to be accepted, and 400 MB that used to be allocated before the byte check.
      '{{#lookup school "logoUrl"}}{{/lookup}}'.repeat(24),
      '{{#lookup school "logoUrl"}}{{/lookup}}'.repeat(400),
      // Inline partials doubling static text: 16 MB, 0.5 GB and 16 GB.
      `${doubling}{{> p14}}`,
      `${doubling}{{> p19}}`,
      `${doubling}{{> p24}}`,
      '{{#*inline "l"}}{{{school.logoUrl}}}{{/inline}}' + '{{> l}}'.repeat(30),
    ]) {
      expect(() => renderDocument(template, hostile), template.slice(0, 60)).toThrowError(badRequest);
    }
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(process.memoryUsage().rss - before).toBeLessThan(100_000_000);
  });

  it('gives a batch one budget, not one per document', () => {
    const photo = 'P'.repeat(1_000);
    const contexts = Array.from({ length: 10 }, (_, index) => ({ name: `Student ${index}`, photo }));
    const template = '<p>{{name}}</p>{{{photo}}}';
    const documents = renderDocuments(template, contexts, { maxOutputChars: 11_000 });
    expect(documents).toHaveLength(10);
    expect(documents[9]).toContain('<p>Student 9</p>');
    // Each document alone fits 6 KB; ten of them do not.
    expect(() => renderDocument(template, contexts[0]!, { maxOutputChars: 6_000 })).not.toThrow();
    expect(() => renderDocuments(template, contexts, { maxOutputChars: 6_000 })).toThrowError(overBudget);
    expect(DOCUMENT_RENDER_MAX_CHARS).toBe(25_000_000);
  });

  it('renders every marketplace design exactly as plain Handlebars does, counted to the character', () => {
    expect(DOCUMENT_MARKETPLACE.length).toBeGreaterThan(0);
    for (const item of DOCUMENT_MARKETPLACE) {
      const sample = sampleDocumentContext(item.documentType);
      const expected = reference.compile(item.content)(sample);
      const measured = measureDocumentRender(item.content, sample);
      expect(measured.raw, item.slug).toBe(expected);
      expect(measured.chars, item.slug).toBe(expected.length);
    }
  });

  it('leaves the next render usable after one was refused or failed', () => {
    expect(() => renderDocument('{{a}}', { a: 'x'.repeat(100) }, { maxOutputChars: 10 })).toThrowError(overBudget);
    expect(() => renderDocument('{{#if}}', {})).toThrowError(badRequest);
    expect(renderDocument('<p>{{a}}</p>', { a: 'ok' })).toContain('<p>ok</p>');
  });
});
