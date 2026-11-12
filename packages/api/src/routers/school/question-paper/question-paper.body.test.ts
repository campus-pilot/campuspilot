import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from '@campuspilot/question-paper/examples';
import { QUESTION_PAPER_LIMITS as L } from '@campuspilot/question-paper/limits';
import { describe, expect, it } from 'vitest';

import {
  figureIdsToPlaceholders,
  fragmentFigureIds,
  renderQuestionPaperBodyHtml,
  type FigureAssets,
} from './question-paper.body';
import { createMathRenderer, escapeHtml, findMathSpans, katexInlineCss, renderMathSpans, texErrorMessage, type MathRenderer } from './question-paper.math';

const QPF = 'qpf_0123456789abcdefghijk';
const ASAT = 'asat_0123456789abcdefghijk';
const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

const render = (fragment: string, figures: FigureAssets = new Map(), math: MathRenderer = createMathRenderer()) =>
  renderQuestionPaperBodyHtml(fragment, { figures, math });

/** The `<div class="qp-body">` part, without the (constant) stylesheet. */
const markup = (html: string) => html.slice(html.indexOf('</style><div class="qp-body">') + '</style>'.length);

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('renderQuestionPaperBodyHtml: formulas', () => {
  it('replaces an empty data-math span with KaTeX HTML and removes the attribute', () => {
    const body = render('<p>Solve <span data-math="\\frac{x}{3}+\\sqrt{16}=7"></span> now</p>');
    expect(body.hasMath).toBe(true);
    expect(body.warnings).toEqual([]);
    expect(markup(body.html)).toMatch(/^<div class="qp-body"><p>Solve <span class="qp-math"><span class="katex">/);
    expect(body.html).not.toContain('data-math');
    expect(body.html).toContain('@font-face');
    expect(body.html).not.toContain('<annotation');
  });

  it('typesets display formulas in a block span', () => {
    const body = render('<span data-math="x^2" data-display="true"></span>');
    expect(markup(body.html)).toContain('<span class="qp-math-display"><span class="katex-display">');
  });

  it('typesets a fraction, a root and a matrix, in the Hindi example too', () => {
    const body = render(EXAMPLE_HINDI_MATH_HTML);
    expect(body.warnings).toEqual([]);
    expect(body.html).toContain('class="mfrac"');
    expect(body.html).toMatch(/class="mord sqrt"/);
    expect(body.html).toContain('class="mtable"');
    expect(body.html).toContain('खंड अ');
  });

  it('adds the KaTeX stylesheet only to a paper that has a formula', () => {
    expect(render('<p>plain</p>').html).not.toContain('@font-face');
    expect(render('<p>plain</p>').hasMath).toBe(false);
    expect(katexInlineCss()).toContain('data:font/woff2;base64');
    expect(katexInlineCss()).not.toMatch(/url\(fonts\//);
  });

  it('prints a formula KaTeX rejects as its raw LaTeX in a marked element, and keeps going', () => {
    const body = render('<p><span data-math="\\frac{1"></span> then <span data-math="x"></span></p>');
    expect(markup(body.html)).toContain('<code class="qp-math-error">\\frac{1</code>');
    expect(body.html).toContain('class="katex"');
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain('Formula 1 was printed as plain text: Invalid TeX');
  });

  it('cannot be made to print a link, an image or raw html through a formula (trust is off)', () => {
    for (const tex of ['\\href{https://evil.example}{x}', '\\url{https://evil.example}', '\\includegraphics{https://evil.example/x.png}', '\\htmlClass{x}{y}', '\\htmlData{a=b}{y}', '\\htmlStyle{color:red}{y}', '\\htmlId{x}{y}']) {
      const body = render(`<span data-math="${escapeHtml(tex)}"></span>`);
      expect(body.html, tex).not.toMatch(/<a |<img|href=|src=|data-a|id="x"|class="x/);
    }
  });

  it('bounds macro expansion', () => {
    const body = render('<span data-math="\\def\\a{\\a\\a}\\a"></span>');
    expect(body.warnings).toHaveLength(1);
    expect(markup(body.html)).toContain('<code class="qp-math-error">');
  });

  it('prints formulas over the length cap, beyond the count cap and after the time budget as raw LaTeX without throwing', () => {
    const long = render(`<span data-math="${'x'.repeat(L.texChars + 1)}"></span>`);
    expect(long.warnings[0]).toContain(`longer than ${L.texChars}`);
    const many = render('<span data-math="x"></span>'.repeat(L.mathNodes + 2));
    expect(many.warnings).toHaveLength(2);
    expect(many.warnings[0]).toContain(`More than ${L.mathNodes}`);
    const exhausted = render('<span data-math="x"></span><span data-math="y"></span>', new Map(), createMathRenderer(-1));
    expect(exhausted.warnings).toHaveLength(2);
    expect(exhausted.html).toContain('<code class="qp-math-error">x</code>');
  });

  it('never lets a model write KaTeX markup itself: the class is reserved and the span is replaced whole', () => {
    const body = render('<span class="katex"><img src=x onerror=alert(1)>fake</span><span data-math="x"><b>inside</b></span>');
    expect(markup(body.html)).not.toMatch(/onerror|inside|<img/);
    expect(markup(body.html)).toMatch(/^<div class="qp-body"><span>fake<\/span><span class="qp-math"><span class="katex">/);
  });

  it('does not interpret $ patterns in a formula or in the text (slicing, not String.replace)', () => {
    const body = render('<p>$& $1 $$</p><span data-math="a$&amp;b$1"></span>');
    expect(markup(body.html)).toContain('<p>$&amp; $1 $$</p>');
  });

  it('finds nested spans and attribute escapes in sanitiser output', () => {
    const html = '<p><span data-math="a&amp;b&quot;c" data-display="true"><span>x</span></span> and <span class="k"><span data-math="y"></span></span></p>';
    const spans = findMathSpans(html);
    expect(spans.map((span) => [span.tex, span.display])).toEqual([['a&b"c', true], ['y', false]]);
    expect(html.slice(spans[0]!.start, spans[0]!.end)).toBe('<span data-math="a&amp;b&quot;c" data-display="true"><span>x</span></span>');
  });

  it('tells a TeX error without its prefix', () => {
    expect(texErrorMessage(new Error('KaTeX parse error: Expected \'EOF\''))).toBe("Expected 'EOF'");
  });

  it('counts the bytes of the formulas it typeset', () => {
    const math = createMathRenderer();
    renderMathSpans('<span data-math="x^2"></span><span data-math="x^2"></span>', math);
    expect(math.renderedBytes()).toBeGreaterThan(0);
  });
});

describe('renderQuestionPaperBodyHtml: figures', () => {
  it('replaces data-figure-id with the stored image as a data URI and keeps alt, caption and size', () => {
    const body = render(`<figure><img data-figure-id="${QPF}" alt="A graph" style="width:60mm"><figcaption>Fig 1</figcaption></figure>`, new Map([[QPF, { dataUri: PIXEL }]]));
    for (const part of [`src="${PIXEL}"`, 'alt="A graph"', 'style="width:60mm"', '<figcaption>Fig 1</figcaption>']) expect(markup(body.html)).toContain(part);
    expect(body.html).not.toContain('data-figure-id');
    expect(body.figureCount).toBe(1);
  });

  it('puts the image into a figure that only names an id, and not twice when it also holds an img', () => {
    const figures = new Map([[QPF, { dataUri: PIXEL }]]);
    const named = render(`<figure data-figure-id="${QPF}"><figcaption>c</figcaption></figure>`, figures);
    expect(markup(named.html)).toBe(`<div class="qp-body"><figure><img src="${PIXEL}" alt=""><figcaption>c</figcaption></figure></div>`);
    const both = render(`<figure data-figure-id="${QPF}"><img data-figure-id="${QPF}" alt="a"></figure>`, figures);
    expect(both.html.split(PIXEL).length - 1).toBe(1);
  });

  it('prints an unknown id as a note with a warning, never as someone else\'s image', () => {
    const body = render(`<p><img data-figure-id="${ASAT}" alt="x"></p>`);
    expect(markup(body.html)).toContain('<span class="qp-figure-placeholder">Figure unavailable</span>');
    expect(body.warnings).toEqual([`The figure ${ASAT} could not be found, so it was not printed.`]);
  });

  it('prints a placeholder as a labelled dashed box with its description, escaped', () => {
    const body = render('<figure data-placeholder="Diagram of a <heart> &amp; lungs" style="width:60%"><figcaption>Fig 2</figcaption></figure>');
    expect(markup(body.html)).toBe(
      '<div class="qp-body"><figure class="qp-figure-placeholder" style="width:60%"><div>Figure to be added</div><div>Diagram of a &lt;heart&gt; &amp; lungs</div><figcaption>Fig 2</figcaption></figure></div>',
    );
    expect(body.figureCount).toBe(1);
  });

  it('lists the figure ids of a stored fragment, once each', () => {
    expect(fragmentFigureIds(`<img data-figure-id="${QPF}"><img data-figure-id="${QPF}"><img data-figure-id="${ASAT}"><img data-figure-id="bad">`)).toEqual([QPF, ASAT]);
  });

  it('turns unusable figure ids into placeholders in sanitiser output', () => {
    const html = `<figure><img data-figure-id="${ASAT}" alt="A heart"></figure><figure data-figure-id="${QPF}"><figcaption>c</figcaption></figure><img data-figure-id="${QPF}">`;
    const cleaned = figureIdsToPlaceholders(html, new Set([ASAT]));
    expect(cleaned).toContain('<figure data-placeholder="A heart"></figure>');
    expect(cleaned).toContain(`<figure data-figure-id="${QPF}">`);
    const both = figureIdsToPlaceholders(html, new Set([ASAT, QPF]));
    expect(both).not.toContain('data-figure-id');
    expect(both).toContain('<figure data-placeholder="Figure"><figcaption>c</figcaption></figure>');
  });
});

describe('renderQuestionPaperBodyHtml: safety', () => {
  const hostile = `
    <style>@import url(https://evil.example/a.css);body{background:red}.a{animation:x 1s;background:url(https://evil.example/i.png);color:red}@keyframes x{from{opacity:0}}</style>
    <script>alert(1)</script><p class="a" onclick="alert(2)" style="transition:all 1s;color:blue">hi</p>
    <svg viewBox="0 0 10 10"><circle r="3" cx="5" cy="5"><animate attributeName="r" dur="1s" repeatCount="indefinite"/></circle><foreignObject><div>x</div></foreignObject></svg>
    <iframe src="https://evil.example"></iframe><a href="javascript:alert(3)">link</a><img src="https://evil.example/x.png">`;

  it('prints nothing active from a hostile fragment', () => {
    const body = render(hostile);
    const text = markup(body.html);
    expect(text).not.toMatch(/<script|<iframe|<animate|foreignobject|onclick|javascript:|evil\.example|@import|keyframes|animation|transition|href=|<a /i);
    expect(text).toContain('<p class="a" style="color:blue">hi</p>');
    expect(text).toContain('.qp-body .a{color:red}');
  });

  it('is a function of the fragment alone: the same input renders the same bytes', () => {
    for (const example of [EXAMPLE_HINDI_MATH_HTML, EXAMPLE_ENGLISH_SCIENCE_HTML]) {
      expect(render(example).html).toBe(render(example).html);
    }
  });

  it('inserts an <img src> only from the figures it was given', () => {
    const body = render(`<img src="${PIXEL}" data-figure-id="${QPF}"><img src="https://evil.example/x.png">`, new Map([[QPF, { dataUri: PIXEL }]]));
    expect(markup(body.html).match(/<img[^>]*>/g)).toEqual([`<img src="${PIXEL}">`]);
  });

  it('puts the cleaned fragment in the body wrapper and the stylesheet in front of it', () => {
    const body = render('<p>a</p>');
    expect(body.html.startsWith('<style>.qp-body{font-size:11pt')).toBe(true);
    expect(body.html.endsWith('<div class="qp-body"><p>a</p></div>')).toBe(true);
    expect(body.byteSize).toBe(Buffer.byteLength(body.html, 'utf8'));
  });
});

describe('the built-in examples', () => {
  it.each([
    ['english-science', EXAMPLE_ENGLISH_SCIENCE_HTML],
    ['hindi-maths', EXAMPLE_HINDI_MATH_HTML],
  ])('render %s with nothing stripped and no warnings', (_name, example) => {
    const body = render(example);
    expect(body.warnings).toEqual([]);
    expect(body.html).toContain('class="qp-body"');
  });

  it('count the placeholder of the science example as a figure', () => {
    expect(render(EXAMPLE_ENGLISH_SCIENCE_HTML).figureCount).toBe(1);
  });
});
