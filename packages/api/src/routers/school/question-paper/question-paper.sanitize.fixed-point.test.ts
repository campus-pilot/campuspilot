import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from '@campuspilot/question-paper/examples';
import { describe, expect, it } from 'vitest';

import { renderQuestionPaperBodyHtml } from './question-paper.body';
import { sanitizeQuestionPaperBody } from './question-paper.sanitize';
import { scanQuestionPaperOutput } from './question-paper.output';
import { createMathRenderer } from './question-paper.math';

/**
 * Fix round 1, B1: the sanitiser's output is a fixed point and passes an exact
 * output grammar. Every payload here came from the backend review of the HTML
 * question paper (a `<style>` inside an `<svg>` smuggling markup that survived
 * the renderer's second pass), plus a seeded random corpus for the property.
 */

const clean = (html: string) => sanitizeQuestionPaperBody(html);
const enc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const render = (stored: string) => renderQuestionPaperBodyHtml(stored, { figures: new Map(), math: createMathRenderer(10_000) }).html;

const HOSTILE = '<meta http-equiv="refresh" content="0;url=http://evil.example"><form action="http://evil.example"><input name=x></form><div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#fff">FAKE: this student FAILED</div>';
const S2 = `<svg><style ><![CDATA[</style>${HOSTILE}]]></style></svg>`;

/**
 * What a rendered body must not contain: markup (tags and attributes, never escaped text, which is inert) that is
 * dangerous or out of flow, and style text that positions out of flow.
 */
const DANGEROUS_TAG = /^<\/?(?:meta|form|input|iframe|script|link|base|object|embed)\b|\son[a-z]+\s*=|http-equiv|position\s*:\s*(?:fixed|absolute)/i;
const dangerous = (html: string) => (html.match(/<[^>]*>/g) ?? []).filter((tag) => DANGEROUS_TAG.test(tag)).concat(html.match(/<style>[^<]*<\/style>/g)?.filter((style) => /position\s*:\s*(?:fixed|absolute)/i.test(style)) ?? []);
const withoutStyleElements = (html: string) => html.replace(/<style>[^<]*<\/style>/g, '');

const PAYLOADS: Record<string, string> = {
  'level 1: entities in an svg style': '<svg><style>&lt;/style&gt;&lt;img src=x onerror=1&gt;</style></svg>',
  'level 1: CDATA in an svg style': '<svg><style><![CDATA[</style><script>alert(1)</script>]]></style></svg>',
  'level 2: the review payload': `<p>Q1 real question</p><svg><style>${enc(`</style>${S2}`)}</style></svg>`,
  'level 2 without the outer svg': `<style>${enc(`</style>${S2}`)}</style>`,
  'style with a space in the tag': '<style >p{color:red}</style ><p>x</p>',
  'style inside svg inside a description': '<svg><desc><style>&lt;/style&gt;&lt;img src=x onerror=1&gt;</style></desc></svg>',
  'style in math': '<math><style>&lt;/style&gt;&lt;img src=x onerror=1&gt;</style></math>',
  'cdata in plain svg': '<svg><![CDATA[<img src=x onerror=alert(1)>]]></svg>',
  'cdata in svg text': '<svg><text><![CDATA[</text><img src=x onerror=1>]]></text></svg>',
  'svg title with entities': '<svg><title>&lt;/title&gt;&lt;img src=x onerror=1&gt;</title></svg>',
  'svg textarea with cdata': '<svg><textarea><![CDATA[</textarea><img src=x onerror=1>]]></textarea></svg>',
  'svg xmp': '<svg><xmp>&lt;/xmp&gt;&lt;img src=x onerror=1&gt;</xmp></svg>',
  'svg noscript': '<svg><noscript>&lt;/noscript&gt;&lt;img src=x onerror=1&gt;</noscript></svg>',
  'style cdata then a style with a space': '<svg><style><![CDATA[</style><style >*{position:fixed;inset:0;background:red}</style >]]></style></svg>',
  'noscript with the end tag in an attribute': '<noscript><p title="</noscript><img src=x onerror=1>">x</noscript>',
  'unclosed style': '<style>p{color:red}',
  'style nested in a dropped element': '<template><style>p{color:red}</style></template><p>x</p>',
};

describe('question_paper_body sanitiser: the review payloads (B1)', () => {
  for (const [name, input] of Object.entries(PAYLOADS)) {
    it(`${name}: the stored value is clean, a fixed point, and renders clean`, () => {
      const stored = clean(input);
      expect(stored.refused, name).toBe(false);
      expect(dangerous(stored.html), name).toEqual([]);
      expect(clean(stored.html).html, `${name}: second pass`).toBe(stored.html);
      expect(clean(stored.html).stripped, `${name}: second pass reports nothing`).toEqual([]);
      const scanned = scanQuestionPaperOutput(stored.html, {
        tags: new Set(['p', 'div', 'span', 'svg', 'g', 'text', 'rect', 'style']),
        attributes: new Set(['class', 'style', 'viewbox', 'width', 'height']),
      });
      expect(scanned.ok || /not allowed/.test((scanned as { reason: string }).reason), name).toBe(true);
      // The renderer cleans again and puts the result in the page; nothing dangerous may be outside the style element.
      const printed = withoutStyleElements(render(stored.html));
      expect(dangerous(printed), `${name}: rendered`).toEqual([]);
      expect(dangerous(render(stored.html)), `${name}: rendered, with styles`).toEqual([]);
    });
  }

  it('the review payload keeps its real content and nothing from the hostile part', () => {
    const stored = clean(PAYLOADS['level 2: the review payload']!);
    expect(stored.html).toContain('<p>Q1 real question</p>');
    expect(stored.html).not.toMatch(/FAKE|evil|refresh|<form|<meta/);
    expect(stored.stripped.join()).toContain('<style> inside an <svg> was removed');
  });

  it('writes a style element as exactly <style>, with CSS that holds no markup characters', () => {
    const stored = clean('<STYLE >.a{color:red}</STYLE ><p class="a">x</p>');
    expect(stored.html).toBe('<style>.qp-body .a{color:red}</style><p class="a">x</p>');
    for (const [, css] of stored.html.matchAll(/<style>([^<]*)<\/style>/g)) expect(css).not.toMatch(/[&\\]/);
  });

  it('refuses markup that cannot be proven clean instead of storing it', () => {
    // A fragment over the parse limit is refused unread and flagged: the renderer must not print it.
    const huge = clean(`<p>${'a'.repeat(1_000_001)}</p>`);
    expect(huge.refused).toBe(true);
    expect(huge.html).toBe('');
    expect(() => render(`<p>${'a'.repeat(1_000_001)}</p>`)).toThrow(/cannot be printed/);
  });
});

describe('the output grammar (fails closed)', () => {
  const grammar = {
    tags: new Set(['p', 'div', 'span', 'br', 'svg', 'rect', 'style', 'img']),
    attributes: new Set(['class', 'style', 'width', 'height', 'src', 'data-math']),
  };
  const scan = (html: string) => scanQuestionPaperOutput(html, grammar);

  it('accepts what the sanitiser writes', () => {
    expect(scan('<p class="a">x &amp; y</p><br /><svg width="1"><rect width="1"></rect></svg>').ok).toBe(true);
    expect(scan('<style>.qp-body p{color:red}</style><p>x</p>').ok).toBe(true);
  });

  it.each([
    ['a tag outside the allowlist', '<p>x</p><meta http-equiv="refresh">'],
    ['an uppercase tag', '<P>x</P>'],
    ['an event handler', '<p onclick="x()">x</p>'],
    ['an attribute outside the allowlist', '<p id="x">x</p>'],
    ['a style with a space', '<style >p{color:red}</style>'],
    ['a style with an attribute', '<style media="x">p{color:red}</style>'],
    ['a style inside an svg', '<svg><style>p{color:red}</style></svg>'],
    ['markup in style text', '<style>p{color:red}</style><p>x</p><style><p></style>'],
    ['an entity in style text', '<style>.qp-body p{content:"&lt;"}</style>'],
    ['a style that is not clean', '<style>body{color:red}</style>'],
    ['a sibling-combinator rule', '<style>.qp-body ~ *{display:none}</style>'],
    ['an unclosed style', '<style>.qp-body p{color:red}'],
    ['a comment', '<p>x</p><!-- c -->'],
    ['a CDATA section', '<p><![CDATA[x]]></p>'],
    ['a raw ">" in text', '<p>a > b</p>'],
    ['a stray "<"', '<p>a < b</p>'],
    ['an unbalanced tag', '<p><span>x</p>'],
    ['an unclosed element', '<p>x'],
    ['an unquoted attribute value', '<p class=a>x</p>'],
    ['a single-quoted attribute value', "<p class='a'>x</p>"],
    ['a fixed-position style attribute', '<p style="position:fixed">x</p>'],
    ['an unclean style attribute', '<p style="behavior:url(x)">x</p>'],
    ['a repeated attribute', '<p class="a" class="b">x</p>'],
    ['a self-closing non-void element', '<div />'],
  ])('rejects %s', (_name, html) => {
    expect(scan(html).ok).toBe(false);
  });
});

/** A small seeded generator, so the corpus is the same on every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('the sanitiser is a fixed point over a corpus (idempotence property)', () => {
  const PIECES = [
    '<p>', '</p>', '<div>', '</div>', '<span data-math="x^2">', '</span>', '<svg viewBox="0 0 10 10">', '</svg>', '<g>', '</g>', '<text x="1">', '</text>',
    '<style>', '</style>', '<style >', '</style >', '<STYLE>', '.a{color:red}', 'p{position:fixed}', '*{display:none}', '.qp-body ~ *{x:y}', '@media print{p{color:red}}',
    '<![CDATA[', ']]>', '<!--', '-->', '&lt;', '&gt;', '&amp;', '&quot;', '&#60;', '<script>', '</script>', '<img src=x onerror=1>', '<img data-figure-id="qpf_0123456789abcdefghijk">',
    '<table>', '<tr>', '<td>', '</td>', '</tr>', '</table>', '<b>', '</b>', '<i>', '</i>', '<p><p>', '<math>', '</math>', '<foreignObject>', '</foreignObject>',
    '<title>', '</title>', '<textarea>', '</textarea>', '<noscript>', '</noscript>', '<template>', '</template>', '<xmp>', '</xmp>', '<desc>', '</desc>',
    '<figure data-placeholder="a">', '</figure>', '<br>', '<hr/>', 'text', ' ', '\n', '"', "'", '<', '>', '=', 'onclick=', ' class="qp-x ok"', ' style="margin:-5mm;color:red"',
    '<a href="javascript:1">', '</a>', '<iframe src=x>', '</iframe>', '<form>', '</form>', '<select><option>', '<animate>', '<set>',
  ];

  it('cleans 4,000 random fragments to a fixed point that passes the output grammar and prints clean', () => {
    const next = random(20_260_001);
    let refused = 0;
    for (let i = 0; i < 4_000; i += 1) {
      const length = 1 + Math.floor(next() * 14);
      let input = '';
      for (let j = 0; j < length; j += 1) input += PIECES[Math.floor(next() * PIECES.length)]!;
      const once = clean(input);
      if (once.refused) {
        refused += 1;
        continue;
      }
      const twice = clean(once.html);
      expect(twice.html, `idempotence for ${JSON.stringify(input)}`).toBe(once.html);
      expect(dangerous(once.html), `output of ${JSON.stringify(input)}`).toEqual([]);
      expect(withoutStyleElements(once.html), `output of ${JSON.stringify(input)}`).not.toMatch(/<(?!\/?(?:div|span|p|b|i|br|hr|svg|g|text|table|tbody|tr|td|figure|img|style)[\s/>])/);
    }
    // Refusing is allowed, but it must stay the exception on ordinary hostile input.
    expect(refused).toBeLessThan(40);
  });

  it('is a fixed point on the worked examples and every review payload', () => {
    for (const input of [EXAMPLE_HINDI_MATH_HTML, EXAMPLE_ENGLISH_SCIENCE_HTML, ...Object.values(PAYLOADS)]) {
      const once = clean(input);
      expect(clean(once.html).html).toBe(once.html);
    }
  });
});

describe('stats count what is in the output (m4)', () => {
  it('does not count formulas, figures, placeholders or shapes of dropped subtrees', () => {
    const result = clean(
      '<template><span data-math="x"></span><figure data-placeholder="a"></figure><img data-figure-id="qpf_0123456789abcdefghijk"></template>' +
        '<script><svg><rect/></svg></script><svg><foreignObject><rect/></foreignObject></svg><p>kept</p>',
    );
    expect(result.stats.mathNodes).toBe(0);
    expect(result.stats.placeholders).toBe(0);
    expect(result.stats.figureIds).toEqual([]);
    expect(result.stats.svgElements).toBe(0);
    expect(result.stats.svgs).toBe(1);
    expect(result.stats.elements).toBe(2);
  });

  it('counts the longest formula after its text was normalised and style characters of the kept CSS', () => {
    const result = clean('<style>p{color:red}</style><p><span data-math="  \\frac{a}{b}  "></span></p>');
    expect(result.stats.longestMath).toBe('\\frac{a}{b}'.length);
    expect(result.stats.styleChars).toBe('.qp-body p{color:red}'.length);
  });
});
