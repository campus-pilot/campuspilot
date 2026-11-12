import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { normalizeQuestionPaper } from '@campuspilot/question-paper/normalize';
import type { QuestionPaper } from '@campuspilot/question-paper/schema';
import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  formatMarks,
  paperFigureIds,
  QUESTION_PAPER_BODY_MAX_BYTES,
  renderQuestionPaperBodyHtml,
  type FigureAssets,
} from './question-paper.body';
import { createMathRenderer, katexInlineCss, texErrorMessage, validatePaperMath, type MathRenderer } from './question-paper.math';

function paper(input: unknown): QuestionPaper {
  const result = normalizeQuestionPaper(input);
  if (!result.ok) throw new Error(`Invalid test paper: ${JSON.stringify(result.errors)}`);
  return result.value;
}

const BASE = { schemaVersion: 1, meta: { language: 'en', script: 'latin', direction: 'ltr' } } as const;
const simple = (question: Record<string, unknown>, meta: Record<string, unknown> = {}) =>
  paper({ ...BASE, meta: { ...BASE.meta, ...meta }, sections: [{ questions: [{ number: '1', type: 'short_answer', marks: 2, text: 'Q', ...question }] }] });

const render = (content: QuestionPaper, figures: FigureAssets = new Map(), math: MathRenderer = createMathRenderer()) =>
  renderQuestionPaperBodyHtml(content, { figures, math });

/** The `<div class="qp-body ...">` part, without the (constant) stylesheet. */
const markup = (html: string) => html.slice(html.indexOf('</style>') + '</style>'.length);

const EVIL = '<script>alert(1)</script> "onerror=alert(2)" \'x\' & <img src=x>';

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('renderQuestionPaperBodyHtml: safety', () => {
  const everyString = paper({
    ...BASE,
    title: EVIL,
    generalInstructions: [EVIL],
    sections: [
      {
        heading: EVIL,
        instructions: [EVIL],
        blocks: [
          { type: 'paragraph', text: EVIL },
          { type: 'figure_placeholder', description: EVIL, caption: EVIL },
          { type: 'table', header: true, caption: EVIL, rows: [[EVIL, EVIL], [EVIL, [{ t: 'text', v: EVIL, b: true }]]] },
        ],
        questions: [
          {
            number: EVIL.slice(0, 10),
            type: 'mcq',
            marks: 1,
            text: [{ t: 'text', v: EVIL, i: true }, ' ', { t: 'br' }, EVIL],
            options: [
              { label: '<b>', text: EVIL },
              { label: '"x"', text: EVIL, blocks: [{ type: 'figure_placeholder', description: EVIL }] },
            ],
            parts: [{ label: '<i>', text: EVIL, marks: null, parts: [{ label: "'", text: EVIL, marks: 1 }] }],
            alternatives: [{ text: EVIL, marks: 1 }],
          },
        ],
      },
    ],
  });
  const { html } = render(everyString);
  const body = markup(html);

  it('never writes a JSON string as markup', () => {
    expect(body).not.toContain('<script');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('onerror=alert(2)" ');
    expect(body).not.toMatch(/<[^>]*"onerror/);
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('&quot;onerror=alert(2)&quot;');
  });

  it('uses only the fixed element and class vocabulary', () => {
    const tags = new Set([...body.matchAll(/<([a-z0-9]+)[\s>]/g)].map((match) => match[1]));
    expect([...tags].sort()).toEqual(
      ['br', 'caption', 'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'li', 'ol', 'p', 'section', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'].sort(),
    );
    const classes = new Set([...body.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1]!.split(' ')));
    for (const name of classes) expect(name, name).toMatch(/^qp-[a-z-]+$/);
    // No attribute other than the fixed ones appears anywhere in the body.
    const attributes = new Set([...body.matchAll(/\s([a-z-]+)="/g)].map((match) => match[1]));
    expect([...attributes].sort()).toEqual(['class', 'dir', 'lang', 'style'].filter((name) => attributes.has(name)).sort());
  });

  it('writes the stylesheet from constants only', () => {
    expect(html.startsWith('<style>')).toBe(true);
    const css = html.slice('<style>'.length, html.indexOf('</style>'));
    expect(css).not.toContain('alert');
    expect(css).not.toContain('<');
  });

  it('refuses an unknown script, language or direction instead of writing it', () => {
    const bad = (meta: Record<string, unknown>) => ({ ...simple({}), meta: { ...simple({}).meta, ...meta } }) as QuestionPaper;
    expect(() => render(bad({ script: '"><script>' }))).toThrow(/Unknown script/);
    expect(() => render(bad({ language: 'x" onclick="y' }))).toThrow(/Unknown language/);
    expect(() => render(bad({ direction: 'sideways' }))).toThrow(/Unknown direction/);
  });

  it('refuses a figure that is not in the paper\'s own assets', () => {
    const content = simple({ blocks: [{ type: 'figure', imageId: 'qpf_aaaaaaaaaaaaaaaaaaaaa', alt: 'x' }] });
    expect(() => render(content)).toThrow(/does not belong to this paper/);
  });

  it('embeds a figure only from its asset, with an escaped alt text', () => {
    const imageId = 'qpf_aaaaaaaaaaaaaaaaaaaaa';
    const content = simple({ blocks: [{ type: 'figure', imageId, alt: EVIL, widthPct: 60, caption: 'A caption' }] });
    expect(paperFigureIds(content)).toEqual([imageId]);
    const { html, figureCount } = render(content, new Map([[imageId, { dataUri: 'data:image/jpeg;base64,AAAA' }]]));
    expect(figureCount).toBe(1);
    expect(markup(html)).toContain('<figure class="qp-figure" style="width:60%"><img src="data:image/jpeg;base64,AAAA" alt="&lt;script&gt;');
    expect(markup(html)).toContain('<figcaption>A caption</figcaption>');
  });

  it('caps the body size', () => {
    const imageId = 'qpf_aaaaaaaaaaaaaaaaaaaaa';
    const content = simple({ blocks: [{ type: 'figure', imageId, alt: 'x' }] });
    const huge = `data:image/jpeg;base64,${'A'.repeat(QUESTION_PAPER_BODY_MAX_BYTES + 1)}`;
    expect(() => render(content, new Map([[imageId, { dataUri: huge }]]))).toThrow(/too large to print/);
  });
});

describe('renderQuestionPaperBodyHtml: content', () => {
  it('prints numbers, labels and marks verbatim and trims marks to two decimals', () => {
    expect(formatMarks(2)).toBe('2');
    expect(formatMarks(2.5)).toBe('2.5');
    expect(formatMarks(0.25)).toBe('0.25');
    const { html } = render(simple({ number: 'Q.14(a)', marks: 2.5 }));
    expect(markup(html)).toContain('<span class="qp-number">Q.14(a)</span>');
    expect(markup(html)).toContain('<span class="qp-marks">[2.5]</span>');
    expect(markup(render(simple({ marks: null })).html)).not.toContain('qp-marks');
  });

  it('styles the paper and its runs by script, language and direction', () => {
    const hindi = render(simple({ text: ['यह ', { t: 'text', v: 'English', lang: 'en', script: 'latin', b: true }, ' शब्द'] }, { language: 'hi', script: 'devanagari' }));
    expect(markup(hindi.html)).toContain('<div class="qp-body qp-script-devanagari" lang="hi" dir="ltr">');
    expect(markup(hindi.html)).toContain('<span class="qp-script-latin" lang="en"><strong>English</strong></span>');
    expect(hindi.html).toContain(".qp-body .qp-script-devanagari{font-family:'Noto Sans Devanagari','Noto Sans',sans-serif}");
    const urdu = render(simple({}, { language: 'ur', script: 'arabic', direction: 'rtl' }));
    expect(markup(urdu.html)).toContain('class="qp-body qp-script-arabic" lang="ur" dir="rtl"');
    // A run that restates the base direction adds nothing; one that differs says so.
    const mixed = render(simple({ text: [{ t: 'text', v: 'abc', dir: 'ltr', script: 'latin' }, { t: 'text', v: 'xyz', dir: 'rtl' }] }, { language: 'ur', script: 'arabic', direction: 'rtl' }));
    expect(markup(mixed.html)).toContain('<span class="qp-script-latin" dir="ltr">abc</span>xyz</div>');
  });

  it('prints the OR label in the language of the paper', () => {
    const withOr = (meta: Record<string, unknown>) => markup(render(simple({ alternatives: [{ text: 'B', marks: 2 }] }, meta)).html);
    expect(withOr({})).toContain('<div class="qp-or">OR</div>');
    expect(withOr({ language: 'hi', script: 'devanagari' })).toContain('<div class="qp-or">अथवा</div>');
    expect(withOr({ language: 'ta', script: 'tamil' })).toContain('<div class="qp-or">அல்லது</div>');
  });

  it('lets only short questions stay together on a page', () => {
    expect(markup(render(simple({})).html)).toContain('class="qp-question qp-keep"');
    expect(markup(render(simple({ parts: [{ label: '(a)', text: 'x', marks: 2 }] })).html)).toContain('class="qp-question"');
  });

  it('renders a table with a header row and a placeholder figure', () => {
    const { html, figureCount } = render(
      simple({
        blocks: [
          { type: 'table', header: true, rows: [['H1', 'H2'], ['a', 'b']] },
          { type: 'figure_placeholder', description: 'A circuit diagram' },
        ],
      }),
    );
    expect(markup(html)).toContain('<thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody>');
    expect(markup(html)).toContain('Figure to be added');
    expect(markup(html)).toContain('A circuit diagram');
    expect(figureCount).toBe(1);
  });
});

describe('renderQuestionPaperBodyHtml: math', () => {
  const content = simple({ text: ['Solve ', { t: 'math', tex: '\\sqrt{x}=\\frac{1}{2}' }, { t: 'math', tex: 'x^2', display: true }] });

  it('typesets formulas with KaTeX, keeping its SVG roots, and inlines the fonts only for papers with math', () => {
    const { html, hasMath } = render(content);
    expect(hasMath).toBe(true);
    expect(markup(html)).toContain('<span class="qp-math"><span class="katex">');
    expect(markup(html)).toContain('<div class="qp-math-display"><span class="katex-display">');
    expect(markup(html)).toContain('<svg');
    // HTML output only: no MathML twin that would print the TeX source twice.
    expect(markup(html)).not.toContain('<math');
    expect(markup(html)).not.toContain('annotation');
    expect(html).toContain('@font-face');
    expect(html).toMatch(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)/);
    expect(html).not.toMatch(/url\(fonts\//);

    const plain = render(simple({}));
    expect(plain.hasMath).toBe(false);
    expect(plain.html).not.toContain('@font-face');
    expect(plain.byteSize).toBeLessThan(20_000);
  });

  it('prints the TeX and reports it when a formula cannot be typeset at print time', () => {
    const failing: MathRenderer = {
      render() {
        throw new Error('KaTeX parse error: Undefined control sequence: \\bad');
      },
    };
    const { html, warnings, hasMath } = render(simple({ text: [{ t: 'math', tex: '\\bad <b>' }] }), new Map(), failing);
    expect(hasMath).toBe(true);
    expect(markup(html)).toContain('<code class="qp-math-error">\\bad &lt;b&gt;</code>');
    expect(warnings).toEqual(['A formula could not be typeset: Undefined control sequence: \\bad']);
  });

  it('propagates a budget refusal instead of hiding it as a print warning', () => {
    const exhausted = createMathRenderer(-1);
    expect(() => render(content, new Map(), exhausted)).toThrow(/too complex to render/);
  });

  it('is a pure function of its input', () => {
    expect(render(content).html).toBe(render(content).html);
  });
});

describe('KaTeX validation and configuration', () => {
  it('reports each bad formula with the path of its run', () => {
    const content = simple({ text: ['ok ', { t: 'math', tex: 'x^2' }, ' bad ', { t: 'math', tex: '\\notacommand{x}' }, { t: 'math', tex: '\\frac{1}' }] });
    const issues = validatePaperMath(content);
    expect(issues.map((issue) => issue.path)).toEqual(['sections[0].questions[0].text[3]', 'sections[0].questions[0].text[4]']);
    expect(issues[0]!.message).toMatch(/^Invalid TeX: Undefined control sequence/);
  });

  it('does not trust the TeX: no links, no raw HTML, no macro definitions that run away', () => {
    const math = createMathRenderer();
    // With trust off KaTeX prints a refused command as plain coloured text: no link, image or class appears.
    for (const tex of ['\\href{https://example.com}{x}', '\\url{https://example.com}', '\\includegraphics{https://example.com/a.png}', '\\htmlClass{evil}{y}', '\\htmlStyle{color:red}{y}', '\\htmlData{a=b}{y}']) {
      const html = math.render(tex, false);
      expect(html, tex).not.toMatch(/<a[\s>]|<img|href=|src=|evil|data-a/);
    }
    expect(() => math.render('\\def\\a{\\a\\a}\\a', false)).toThrow(/Too many expansions/);
    // Sizes are clamped to maxSize (10em), not rejected.
    expect(math.render('\\rule{100em}{1em}', false)).toMatch(/width:10em/);
    // Macros defined by one formula do not leak into the next.
    math.render('\\gdef\\mine{1}\\mine', false);
    expect(() => math.render('\\mine', false)).toThrow();
    expect(texErrorMessage(new Error('KaTeX parse error: x'))).toBe('x');
  });

  it('builds the stylesheet once with every font inlined', () => {
    const css = katexInlineCss();
    expect(css).toBe(katexInlineCss());
    expect(css.length).toBeGreaterThan(100_000);
    expect(css.match(/@font-face/g)!.length).toBe(css.match(/data:font\/woff2/g)!.length);
  });
});

describe('the built-in examples', () => {
  it.each(QUESTION_PAPER_EXAMPLES.map((example, index) => [index === 0 ? 'hindi-math' : 'english-science', example] as const))(
    'render %s deterministically',
    (_name, example) => {
      const content = paper(example);
      const first = render(content);
      expect(first.html).toBe(render(content).html);
      expect(first.warnings).toEqual([]);
      expect(markup(first.html)).toMatchSnapshot();
    },
  );
});
