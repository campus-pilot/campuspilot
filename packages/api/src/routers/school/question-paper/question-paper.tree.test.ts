import { QUESTION_PAPER_LIMITS as L } from '@campuspilot/question-paper/limits';
import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from '@campuspilot/question-paper/examples';
import { defaultTreeAdapter, parse, type DefaultTreeAdapterMap } from 'parse5';
import { describe, expect, it } from 'vitest';

import { renderQuestionPaperBodyHtml } from './question-paper.body';
import { createMathRenderer } from './question-paper.math';
import { sanitizeQuestionPaperBody } from './question-paper.sanitize';

/**
 * Fix round 3, review-html-2-backend.md M1: the stored text must mean to the browser's tree builder what the sanitiser
 * and the output grammar saw. These tests check it INDEPENDENTLY of the code under test: they render a paper into a
 * page shaped like the template (header, body, footer) and parse that page with parse5, then ask where things landed.
 */

const clean = (html: string) => sanitizeQuestionPaperBody(html);
const render = (stored: string) => renderQuestionPaperBodyHtml(stored, { figures: new Map(), math: createMathRenderer(10_000) }).html;

type Node = DefaultTreeAdapterMap['node'];
const children = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);
const find = (node: Node, test: (element: Node) => boolean): Node | undefined => {
  if (test(node)) return node;
  for (const child of children(node)) {
    const found = find(child, test);
    if (found) return found;
  }
  return undefined;
};
const name = (node: Node) => (defaultTreeAdapter.isElementNode(node) ? defaultTreeAdapter.getTagName(node) : '');
const attr = (node: Node, key: string) => (defaultTreeAdapter.isElementNode(node) ? defaultTreeAdapter.getAttrList(node).find((a) => a.name === key)?.value : undefined);
const text = (node: Node): string => (defaultTreeAdapter.isTextNode(node) ? defaultTreeAdapter.getTextNodeContent(node) : children(node).map(text).join(''));

/** Renders `stored` between a header and a footer inside a container div (the shape of the shipped templates). */
function page(stored: string) {
  const document = parse(`<!doctype html><html><head></head><body><div id="frame"><header id="hdr">H</header>${render(stored)}<footer id="ftr">F</footer></div><p id="after">after</p></body></html>`);
  const frame = find(document, (n) => attr(n, 'id') === 'frame')!;
  return { document, frame, wrapper: find(document, (n) => attr(n, 'class') === 'qp-body')!, footer: find(document, (n) => attr(n, 'id') === 'ftr')! };
}

/** Everything inside the frame is a direct child of it or of the wrapper, and the footer is still in the frame. */
function expectContained(stored: string, marker: string) {
  const { document, frame, wrapper, footer } = page(stored);
  expect(text(wrapper), 'the marker text is inside the wrapper').toContain(marker);
  expect(children(frame).filter((n) => name(n) !== '').map(name), 'the frame holds header, style, wrapper, footer and nothing else').toEqual(['header', 'style', 'div', 'footer']);
  expect(children(frame).includes(footer)).toBe(true);
  expect(text(find(document, (n) => attr(n, 'id') === 'after')!)).toBe('after');
}

const REPRO_INNOCENT = '<ol><li>Q1 pick one<div class="opts"><li>A</li><li>B</li></div></li></ol><p>Q2 rest of the paper</p>';
const REPRO_ADVERSARIAL = '<ol><li>Q1</li></ol><li><div><li></li></div><p>Q2 after the escape</p>';

describe('question_paper_body: the browser tree builder reads the stored text as the grammar did (M1)', () => {
  for (const [label, input, marker] of [
    ['a list item inside a div inside a list item (sloppy, plausible)', REPRO_INNOCENT, 'Q2 rest of the paper'],
    ['the adversarial list-item repro', REPRO_ADVERSARIAL, 'Q2 after the escape'],
    ['the adversarial repro twice over', `${REPRO_ADVERSARIAL}<li><div><li></li></div><p>Q3 last</p>`, 'Q3 last'],
    ['a table cell outside a table', '<td>stray</td><p>Q2 after cell</p>', 'Q2 after cell'],
    ['a block start tag inside a paragraph', '<p>Q1 <ul><li>a</li></ul></p><p>Q2 after p</p>', 'Q2 after p'],
    ['an svg breakout', '<svg><g><p>out</p></g></svg><p>Q2 after svg</p>', 'Q2 after svg'],
    ['headings and definition-style nesting', '<h2>Section<h3>Sub</h3></h2><p>Q2 after h</p>', 'Q2 after h'],
    ['a table with an implied tbody and a stray close', '<table><tr><td>1</td></tr></div></table><p>Q2 after table</p>', 'Q2 after table'],
  ] as const) {
    it(`${label}: nothing leaves the wrapper, and the stored value is a fixed point`, () => {
      const stored = clean(input);
      expect(stored.refused).toBe(false);
      expectContained(stored.html, marker);
      const again = clean(stored.html);
      expect(again.html).toBe(stored.html);
      expect(again.stripped).toEqual([]);
    });
  }

  it('the innocent repro keeps every word and reads the options as the browser does (siblings of the question)', () => {
    const stored = clean(REPRO_INNOCENT);
    for (const word of ['Q1 pick one', '>A<', '>B<', 'Q2 rest of the paper']) expect(stored.html).toContain(word);
    expect(stored.html).toBe('<ol><li>Q1 pick one<div class="opts"></div></li><li>A</li><li>B</li></ol><p>Q2 rest of the paper</p>');
    // Nothing was lost, so nothing is reported.
    expect(stored.stripped).toEqual([]);
  });

  it('reports an element the browser would drop (a stray table cell), and keeps its text', () => {
    const stored = clean('<td>stray</td><p>x</p>');
    expect(stored.html).toContain('stray');
    expect(stored.stripped.join()).toContain('<td> that cannot stand where it was written was removed');
  });

  it('keeps the model\'s writing in realistic sloppy papers', () => {
    const paper = [
      '<style>.q{margin:0 0 2mm}</style>',
      '<h2 style="text-align:center">Section A</h2>',
      '<table><tr><th>अंक</th><td>10</td></tr><tr><td>विद्यार्थी</td><td>5</td></tr></table>',
      '<ol><li class="q">What is <span data-math="\\frac{a}{b}"></span>? <b>(2)</b><div class="opts"><p>(a) 1</p><p>(b) 2</p></div></li>',
      '<li class="q">द्वारा बताइए<ul><li>पहला</li><li>दूसरा</li></ul></li></ol>',
      '<figure data-placeholder="triangle ABC"><svg viewBox="0 0 10 10" width="100" height="100"><path d="M0 0L10 10"></path><text x="1" y="2">A</text></svg><figcaption>Fig. 1</figcaption></figure>',
      '<p>End of paper</p>',
    ].join('');
    const stored = clean(paper);
    expect(stored.refused).toBe(false);
    expect(stored.stripped).toEqual([]);
    for (const part of ['Section A', 'अंक', 'विद्यार्थी', 'द्वारा बताइए', 'पहला', 'दूसरा', '(a) 1', 'Fig. 1', 'End of paper', 'data-math="\\frac{a}{b}"', '<path d="M0 0L10 10">', '<text x="1" y="2">A</text>']) {
      expect(stored.html, part).toContain(part);
    }
    // The implied tbody is what the browser builds; the cell texts are all there.
    expect(stored.html).toContain('<table><tbody><tr><th>अंक</th>');
    expectContained(stored.html, 'End of paper');
  });

  it('leaves the worked examples of the guide whole (an implied tbody is the only difference)', () => {
    for (const [example, marker] of [[EXAMPLE_HINDI_MATH_HTML, 'विद्यार्थी'], [EXAMPLE_ENGLISH_SCIENCE_HTML, 'animal cell']] as const) {
      const stored = clean(example);
      expect(stored.stripped).toEqual([]);
      expect(stored.problems).toEqual([]);
      expect(stored.html).toContain('<tbody>');
      expectContained(stored.html, marker);
    }
  });

  it('is a fixed point of the real tree builder on 20,000 random token sequences', () => {
    const tokens = [
      '<p>', '</p>', '<div>', '</div>', '<span>', '</span>', '<svg>', '</svg>', '<g>', '</g>', '<table>', '</table>', '<tr>', '</tr>', '<td>', '</td>', '<th>', '<tbody>', '<caption>',
      '<colgroup>', '<col>', '<ul>', '</ul>', '<ol>', '</ol>', '<li>', '</li>', '<b>', '</b>', '<i>', '</i>', '<sub>', '<sup>', '<br>', '<hr>', '<h1>', '</h2>', '<h3>', '<figure>', '</figure>',
      '<figcaption>', '<math>', '<select>', '<form>', '<template>', '<noscript>', '<style>p{color:red}</style>', '<p style="color:red">', '<svg><p>', '<table><tr><td>', 'x', 'Q', 'अ', ' ', '&amp;', '&lt;',
    ];
    let seed = 7;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let n = 0; n < 20_000; n += 1) {
      let input = '';
      for (let i = 0, count = 3 + Math.floor(random() * 20); i < count; i += 1) input += tokens[Math.floor(random() * tokens.length)];
      const stored = clean(input);
      expect(stored.refused, input).toBe(false);
      if (clean(stored.html).html !== stored.html) throw new Error(`not a fixed point: ${input}`);
      const { document, frame } = page(stored.html + '<p>MARK</p>');
      const names = children(frame).filter((node) => name(node) !== '').map(name);
      if (names.join() !== 'header,style,div,footer') throw new Error(`escaped the wrapper: ${input} -> ${stored.html}`);
      expect(text(find(document, (node) => attr(node, 'class') === 'qp-body')!)).toContain('MARK');
    }
  }, 60_000);

  it('stays fast on nesting at the parse limit (the tree check is linear)', () => {
    for (const shape of ['<svg><g>', '<div><b>', '<ul><li>', '<li><div>', '<table><tr><td>', '<p>']) {
      const input = shape.repeat(Math.ceil(L.parseChars / shape.length)).slice(0, L.parseChars);
      const started = performance.now();
      const stored = clean(input);
      expect(performance.now() - started, shape).toBeLessThan(1_500);
      expect(stored.refused, shape).toBe(false);
    }
  });
});
