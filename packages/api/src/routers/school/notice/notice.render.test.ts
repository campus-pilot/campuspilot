import Handlebars from 'handlebars';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_MARKETPLACE, NOTICE_DEFAULT_TEMPLATE_SLUG, SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';
import { combineDocuments, renderDocument } from '../document/document.render';
import { NOTICE_CONTEXT_FIELDS, NOTICE_TEMPLATE_STARTER, NOTICE_TEMPLATE_VARIABLES } from './notice-template-guide';
import { assertValidNoticeTemplate, NOTICE_TEMPLATE_MAX_BLOCK_DEPTH, noticeParagraphs, noticePdfKey } from './notice.render';

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

  it('leaves every other document type on its fixed sheet', () => {
    const html = combineDocuments(['<p>One</p>'], 'report_card');
    expect(html).toContain('height:297mm;overflow:hidden');
  });
});

describe('notice PDF cache key', () => {
  it("lives under the school's prefix, so the demo purge sweep removes it", () => {
    expect(noticePdfKey('sch_1', 'ntc_1')).toBe('schools/sch_1/notices/ntc_1.pdf');
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
