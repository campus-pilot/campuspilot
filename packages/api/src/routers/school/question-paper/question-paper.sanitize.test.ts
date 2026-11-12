import { QUESTION_PAPER_LIMITS as L } from '@campuspilot/question-paper/limits';
import { EXAMPLE_ENGLISH_SCIENCE_HTML, EXAMPLE_HINDI_MATH_HTML } from '@campuspilot/question-paper/examples';
import { describe, expect, it } from 'vitest';

import { sanitizeQuestionPaperBody } from './question-paper.sanitize';

const clean = (html: string) => sanitizeQuestionPaperBody(html);
const FIGURE = 'qpf_0123456789abcdefghijk';

describe('question_paper_body sanitiser: what a good paper keeps', () => {
  it('keeps both worked examples whole, with nothing stripped and no problems', () => {
    for (const example of [EXAMPLE_HINDI_MATH_HTML, EXAMPLE_ENGLISH_SCIENCE_HTML]) {
      const result = clean(example);
      expect(result.stripped).toEqual([]);
      expect(result.problems).toEqual([]);
      expect(result.html).toContain('<table>');
      expect(result.html).toContain('data-math="');
    }
    expect(clean(EXAMPLE_HINDI_MATH_HTML).html).toContain('data-math="2x+3=11"');
    expect(clean(EXAMPLE_HINDI_MATH_HTML).html).toContain('खंड अ');
    expect(clean(EXAMPLE_ENGLISH_SCIENCE_HTML).html).toContain('<svg');
    expect(clean(EXAMPLE_ENGLISH_SCIENCE_HTML).html).toContain('data-placeholder="Hand-drawn labelled diagram');
  });

  it('is idempotent: cleaning the output again changes nothing and reports nothing', () => {
    for (const example of [EXAMPLE_HINDI_MATH_HTML, EXAMPLE_ENGLISH_SCIENCE_HTML]) {
      const once = clean(example);
      const twice = clean(once.html);
      expect(twice.html).toBe(once.html);
      expect(twice.stripped).toEqual([]);
    }
    const hostile = clean('<style>p{color:red;animation:x 1s}</style><script>1</script><p onclick="x" style="transition:all 1s;color:blue">a</p>');
    const again = clean(hostile.html);
    expect(again.html).toBe(hostile.html);
    expect(again.stripped).toEqual([]);
  });

  it('records the figure ids, placeholders, formulas and counts', () => {
    const result = clean(
      `<figure><img data-figure-id="${FIGURE}" alt="a graph"></figure><figure data-placeholder="a map"></figure><p><span data-math="x^2"></span><span data-math="y" data-display></span></p>`,
    );
    expect(result.stats.figureIds).toEqual([FIGURE]);
    expect(result.stats.placeholders).toBe(1);
    expect(result.stats.mathNodes).toBe(2);
    expect(result.html).toContain(`<img data-figure-id="${FIGURE}" alt="a graph" />`);
    expect(result.html).toContain('data-display="true"');
  });

  it('keeps lang, dir and class and scopes a style block under the body wrapper', () => {
    const result = clean('<style>.q{display:flex;gap:2mm}h2,.sec{text-align:center}</style><div class="q" lang="hi" dir="ltr">x</div>');
    expect(result.html).toContain('<style>.qp-body .q{display:flex;gap:2mm}\n.qp-body h2,.qp-body .sec{text-align:center}</style>');
    expect(result.html).toContain('<div class="q" lang="hi" dir="ltr">');
    expect(result.stripped).toEqual([]);
  });

  it('unwraps <html><body> without a finding', () => {
    const result = clean('<!DOCTYPE html><html><head><title>t</title></head><body><p>a</p></body></html>');
    expect(result.html).toBe('<p>a</p>');
    expect(result.stripped.join()).not.toContain('<html>');
  });

  it('keeps a safe inline svg with its own style block', () => {
    const result = clean(
      '<svg viewBox="0 0 10 10" width="100" height="100" role="img" aria-label="d"><style>.a{fill:red;stroke-width:2}</style><g transform="translate(1,2)"><path class="a" d="M0 0 L5 5 Z"/><text x="1" y="2" font-size="3" text-anchor="middle">A</text></g></svg>',
    );
    expect(result.stripped).toEqual([]);
    expect(result.html).toContain('viewbox="0 0 10 10"');
    expect(result.html).toContain('<path class="a" d="M0 0 L5 5 Z"></path>');
    expect(result.html).toContain('.qp-body .a{fill:red;stroke-width:2}');
  });
});

describe('question_paper_body sanitiser: hostile input', () => {
  it('removes script with its content', () => {
    const result = clean('<p>a</p><script>alert(1)</script><p>b</p>');
    expect(result.html).toBe('<p>a</p><p>b</p>');
    expect(result.html).not.toContain('alert');
    expect(result.stripped).toContain('<script> was removed with its content');
  });

  it('removes event handler attributes', () => {
    const result = clean('<img src="x" onerror="alert(1)"><p onclick="x()" onmouseover="y()">a</p>');
    expect(result.html).not.toMatch(/on(error|click|mouseover)/i);
    expect(result.stripped.join()).toContain('event handler');
  });

  it('removes javascript:, data: and any other url, and href and src altogether', () => {
    const result = clean(
      '<a href="javascript:alert(1)">x</a><img src="https://evil.example/x.png"><img src="data:image/png;base64,AAAA"><p style="background:url(https://evil.example/a)">t</p><svg width="1" height="1" fill="url(#g)"><rect width="1" height="1" fill="url(javascript:1)"/></svg>',
    );
    expect(result.html).not.toMatch(/javascript|evil|href|src=|url\(|data:image/i);
    expect(result.html).toContain('x');
  });

  it('removes every animation element and reports them as motion', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle r="2" cx="5" cy="5"><animate attributeName="r" values="1;4" dur="1s" repeatCount="indefinite"/><set attributeName="fill" to="red"/><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/><animateMotion path="M0 0 L9 9" dur="1s"/></circle></svg>';
    const result = clean(svg);
    expect(result.html).not.toMatch(/animate|<set|attributename|dur=|repeatcount/i);
    const notes = result.stripped.join('\n');
    for (const tag of ['animate', 'set', 'animatetransform', 'animatemotion']) expect(notes).toContain(`<${tag}>`);
    expect(notes).toContain('nothing moves');
  });

  it('removes @keyframes and animation, transition and will-change properties', () => {
    const result = clean(
      '<style>@keyframes spin{from{opacity:0}to{opacity:1}}.a{animation:spin 1s infinite;animation-name:spin;transition:all 1s;transition-duration:1s;will-change:transform;color:red}</style><p class="a" style="animation:spin 1s;transition:color 1s;will-change:opacity;color:blue">x</p>',
    );
    expect(result.html).not.toMatch(/keyframes|animation|transition|will-change/i);
    expect(result.html).toContain('.qp-body .a{color:red}');
    expect(result.html).toContain('style="color:blue"');
    const notes = result.stripped.join('\n');
    expect(notes).toContain('@keyframes');
    expect(notes).toContain('"animation"');
    expect(notes).toContain('"transition"');
    expect(notes).toContain('"will-change"');
  });

  it('removes url(), @import and @font-face from style blocks, including escaped spellings', () => {
    const result = clean(
      '<style>@import url(https://evil.example/x.css);@font-face{font-family:x;src:url(https://evil.example/f.woff)}.a{background:url(https://evil.example/i.png);color:red}.b{background:u\\72l(https://evil.example)}.c{color:blue}</style><p>x</p>',
    );
    expect(result.html).not.toMatch(/evil|@import|@font-face|url|\\/i);
    expect(result.html).toContain('.qp-body .a{color:red}');
    expect(result.html).toContain('.qp-body .c{color:blue}');
  });

  it('removes foreignObject with everything inside it', () => {
    const result = clean('<svg viewBox="0 0 10 10"><foreignObject width="10" height="10"><div><img src=x onerror=alert(1)></div></foreignObject><rect width="1" height="1"/></svg>');
    expect(result.html).not.toMatch(/foreignobject|onerror|<div|<img/i);
    expect(result.html).toContain('<rect');
    expect(result.stripped.join()).toContain('<foreignobject> was removed');
  });

  it('removes iframe, object, embed, forms, link, meta, base, use and image', () => {
    const result = clean(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="x"><input name="a"><button>go</button></form><link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0;url=x"><base href="x"><svg><use href="#a"/><image href="x"/></svg><p>kept</p>',
    );
    expect(result.html).not.toMatch(/iframe|object|embed|<form|<input|<button|<link|<meta|<base|<use|<image|evil/i);
    expect(result.html).toContain('<p>kept</p>');
  });

  it('keeps a hostile style block from escaping the wrapper', () => {
    const result = clean(
      '<style>body{background:red}html,.a{color:red}:root{--x:1}.qp-body{display:none}* {color:red} .a, script{x:y} a[href^="javascript"]{color:red} .ok{color:green} div::before{content:"x"} .a:hover{color:red}</style><p>x</p>',
    );
    // Only the bare `*`, the wrapper-itself and .ok rules survive, each prefixed with the wrapper class.
    const rules = result.html.replace(/^<style>/, '').replace(/<\/style>.*$/s, '').split('\n').filter(Boolean);
    for (const rule of rules) expect(rule.startsWith('.qp-body ')).toBe(true);
    expect(result.html).not.toMatch(/\.qp-body\{|\.qp-body \.qp-body|body\{|html|:root|--x|script|href|::before|:hover/);
    expect(result.html).toContain('.qp-body .ok{color:green}');
    expect(result.html).toContain('.qp-body *{color:red}');
  });

  it('refuses positions and lengths that could cover the page footer or make endless pages', () => {
    const result = clean('<p style="position:fixed;bottom:0;color:red">a</p><p style="position:absolute;color:red">b</p><p style="height:99999mm;width:100%;margin:0 0 0 -50000px">c</p><p style="position:relative;top:2mm">d</p>');
    expect(result.html).not.toMatch(/fixed|absolute|99999|50000/);
    expect(result.html).toContain('style="color:red"');
    expect(result.html).toContain('style="position:relative;top:2mm"');
  });

  it('does not let markup hide inside a style block', () => {
    const result = clean('<style></style><img src=x onerror=alert(1)><style><img src=x onerror=alert(2)></style><svg><style><img src=x onerror=alert(3)></style></svg><p>x</p>');
    expect(result.html).not.toMatch(/onerror|alert|<img/);
  });

  it('drops a data-figure-id that is not a stored or attachment id, and an image without one', () => {
    const result = clean('<img data-figure-id="../../etc/passwd" alt="x"><img alt="no id"><p>kept</p>');
    expect(result.html).toBe('<p>kept</p>');
    expect(result.stats.figureIds).toEqual([]);
  });

  it('restricts data-math and data-display to spans and keeps formulas as attribute text only', () => {
    const result = clean('<div data-math="x"></div><span data-math="a&amp;b&quot;<script>"></span>');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('data-math="a&amp;b&quot;&lt;script&gt;"');
    expect(result.stats.mathNodes).toBe(1);
  });

  it('drops reserved class names and unknown attributes', () => {
    const result = clean('<div class="qp-body katex ok question-paper-document" id="qp-body-slot" data-x="1" title="t">x</div>');
    expect(result.html).toBe('<div class="ok">x</div>');
  });

  it('keeps nesting bounded', () => {
    const result = clean(`${'<div>'.repeat(200)}deep${'</div>'.repeat(200)}`);
    expect((result.html.match(/<div>/g) ?? []).length).toBeLessThanOrEqual(40);
  });

  it('refuses a huge input without parsing it', () => {
    const started = performance.now();
    const result = clean(`<p>${'a'.repeat(L.parseChars + 1)}</p>`);
    expect(performance.now() - started).toBeLessThan(200);
    expect(result.html).toBe('');
    expect(result.problems[0]).toContain('limit is');
  });

  it('reports a fragment over the stored limit as a problem and still cleans it', () => {
    const result = clean(`<p>${'a'.repeat(L.fragmentChars + 10)}</p>`);
    expect(result.problems.join()).toContain('characters after cleaning');
  });

  it('reports too many elements, svgs, formulas and figures as problems', () => {
    expect(clean('<i></i>'.repeat(L.elements + 1)).problems.join()).toContain('elements');
    expect(clean('<svg></svg>'.repeat(L.svgs + 1)).problems.join()).toContain('SVG drawings');
    expect(clean(`<span data-math="${'x'.repeat(L.texChars + 1)}"></span>`).problems.join()).toContain('formula');
    expect(clean('<figure data-placeholder="a"></figure>'.repeat(L.figures + 1)).problems.join()).toContain('figures and placeholders');
  });

  it('terminates quickly on pathological input', () => {
    const started = performance.now();
    clean(`<p ${'a="1" '.repeat(5000)}>x</p>` + '<'.repeat(50_000) + '<style>' + '{'.repeat(50_000));
    clean(`<style>${'a{'.repeat(20_000)}</style>`);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
