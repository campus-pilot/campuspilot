import { describe, expect, it } from 'vitest';

import { DOCUMENT_MARKETPLACE } from '../document/document.catalog.marketplace';
import { cleanDeclarations, cleanStyleSheet, RESERVED_CLASS, StripReport } from './question-paper.css';
import { sanitizeQuestionPaperBody } from './question-paper.sanitize';

const sheet = (css: string) => cleanStyleSheet(css, new StripReport(), (name) => ['p', 'div', 'span', 'h2', 'footer', 'li', 'ul', 'td', 'table'].includes(name));
const declarations = (css: string) => cleanDeclarations(css, new StripReport());
const body = (css: string) => sanitizeQuestionPaperBody(`<style>${css}</style><p>x</p>`).html;

describe('selector scoping (M1): a rule matches inside the paper only', () => {
  it.each([
    '.qp-body ~ *',
    '.qp-body ~ footer',
    '.qp-body + *',
    '.qp-body + p',
    '.qp-body~*',
    '.qp-body+p',
    '.qp-body > p',
    '.qp-body',
    '.qp-body.x',
    '.qp-body  ~  .qpc-foot',
    '.qp-body .qp-body ~ *',
  ])('drops %s, however it is spelled', (selector) => {
    expect(sheet(`${selector}{display:none}`)).toBe('');
    expect(body(`${selector}{display:none}`)).not.toContain('display');
  });

  it('prefixes every selector with the wrapper and a descendant combinator, and nothing else', () => {
    expect(sheet('p, .a > li + li ~ td{color:red}')).toBe('.qp-body p,.qp-body .a > li + li ~ td{color:red}');
    // The sibling combinators stay INSIDE the descendants: `.qp-body .a ~ *` matches siblings of `.a`, which are in the paper.
    expect(sheet('.a ~ *{color:red}')).toBe('.qp-body .a ~ *{color:red}');
  });

  it('is idempotent: an already prefixed selector keeps exactly one prefix', () => {
    const once = sheet('p,.a li{color:red}');
    expect(sheet(once)).toBe(once);
    expect(sheet('.qp-body p{color:red}')).toBe('.qp-body p{color:red}');
    expect(sheet('.qp-body   p{color:red}')).toBe('.qp-body p{color:red}');
  });

  it('cannot reach the page, and header/footer elements are not known elements of a paper', () => {
    for (const selector of ['body', 'html', ':root', 'header', 'main', '[href]', 'p:not(.qpc-foot)', 'p:is(body p)', 'p:not(:not(.x))', 'p:has(.x)']) {
      expect(sheet(`${selector}{color:red}`), selector).toBe('');
    }
    expect(body('header{display:none}footer{display:none}')).toBe('<p>x</p>');
  });

  it('accepts pseudo-elements, states and logical pseudo-classes, scoped to the paper', () => {
    expect(sheet('p::before{content:"Q. "}')).toBe('.qp-body p::before{content:"Q. "}');
    expect(sheet('li:after{content:"→"}')).toBe('.qp-body li:after{content:"→"}');
    expect(sheet('.a:hover{color:red}')).toBe('.qp-body .a:hover{color:red}');
    expect(sheet('p:not(.x, .y) > span:is(div, li){color:red}')).toBe('.qp-body p:not(.x,.y) > span:is(div,li){color:red}');
    expect(sheet('ul{counter-reset:q}li::before{content:counter(q) ". ";counter-increment:q}')).toBe(
      '.qp-body ul{counter-reset:q}\n.qp-body li::before{content:counter(q) ". ";counter-increment:q}',
    );
    // Text in content cannot end the style or reopen markup.
    expect(sheet('p::before{content:"<b>"}')).toBe('');
  });

  it('does not accept a reserved class in a selector', () => {
    for (const name of ['qp-math', 'qpc-foot', 'qpk-head', 'katex', 'katex-html', 'question-paper-document', 'qp', 'qpf-x']) {
      expect(sheet(`.${name}{display:none}`), name).toBe('');
      expect(sheet(`p .${name}{display:none}`), name).toBe('');
    }
    expect(sheet('.mine{color:red}')).toBe('.qp-body .mine{color:red}');
  });
});

describe('reserved class names (m1)', () => {
  it('cover every class the built-in question paper designs use', () => {
    const designs = DOCUMENT_MARKETPLACE.filter(({ documentType }) => documentType === 'question_paper');
    expect(designs.length).toBeGreaterThanOrEqual(2);
    for (const design of designs) {
      const classes = [...design.content.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/)).filter((name) => name !== '' && !name.includes('{'));
      expect(classes.length, design.slug).toBeGreaterThan(0);
      for (const name of classes) expect(RESERVED_CLASS.test(name), `${design.slug}: ${name}`).toBe(true);
    }
  });

  it('are removed from class attributes, so a fragment cannot borrow the template or renderer styles', () => {
    const result = sanitizeQuestionPaperBody('<div class="qpc-foot qpk-foot katex qp-math question-paper-x ok">x</div>');
    expect(result.html).toBe('<div class="ok">x</div>');
    expect(result.stripped.join()).toContain('reserved');
  });
});

describe('numbers are capped, not only lengths with a unit (M2)', () => {
  it.each([
    ['calc', 'height:calc(1px*99999999)'],
    ['nested calc', 'width:calc(calc(1px*99999999))'],
    ['min', 'height:min(99999px,99999px)'],
    ['max', 'height:max(1px,99999mm)'],
    ['clamp', 'height:clamp(1px,99999px,99999px)'],
    ['var', 'height:var(--x)'],
    ['env', 'height:env(safe-area-inset-top)'],
    ['scientific height', 'height:1e5mm'],
    ['scientific unitless', 'line-height:1e9'],
    ['uppercase exponent', 'height:1E5mm'],
    ['signed exponent', 'height:1e+5mm'],
    ['huge unitless line-height', 'line-height:99999999'],
    ['huge grid repeat', 'grid-template-rows:repeat(99999,100px)'],
    ['grid repeat above 12', 'grid-template-columns:repeat(13,1fr)'],
    ['many grid tracks', `grid-template-columns:${'1fr '.repeat(41)}`],
    ['huge columns', 'columns:99999'],
    ['huge column-count', 'column-count:7'],
    ['huge tab-size', 'tab-size:99999999'],
    ['huge flex', 'flex:99999'],
    ['huge orphans', 'orphans:99999'],
    ['huge grid line', 'grid-row:1 / 99999'],
    ['huge height', 'height:99999mm'],
    ['huge font size', 'font-size:101em'],
    ['huge negative offset', 'top:-99999mm'],
    ['unknown unit', 'height:5dvh'],
    ['negative margin', 'margin-top:-100000'],
  ])('removes %s', (_name, declaration) => {
    expect(declarations(declaration)).toBe('');
  });

  it('still accepts the ordinary sizes of a paper', () => {
    for (const declaration of [
      'height:12mm', 'width:50%', 'margin:2mm 0 4mm', 'padding:1mm 2mm', 'font-size:11pt', 'font-size:1.1em', 'line-height:1.45', 'line-height:5', 'columns:2', 'column-count:2',
      'grid-template-columns:repeat(2,1fr)', 'grid-template-columns:30mm 1fr auto', 'grid-template-columns:repeat(12,minmax(0,1fr))', 'flex:1 1 0%', 'flex:1', 'aspect-ratio:16/9',
      'color:#1e3a5f', 'color:rgb(255,255,255)', 'background:#fff', 'tab-size:4', 'orphans:2', 'font-weight:700', 'text-indent:-5mm', 'vertical-align:-0.2em',
      "font-family:'Noto Sans',sans-serif", 'border:0.3mm solid #000', 'min-height:100vh', 'gap:2mm', 'opacity:0.5', 'letter-spacing:0.5pt',
    ]) {
      expect(declarations(declaration), declaration).toBe(declaration);
    }
  });

  it('leaves positioning, layering, shadows, gradients and large text to the author', () => {
    for (const declaration of [
      'position:absolute;left:62%;top:18%', 'position:sticky;top:0', 'inset:0', 'z-index:-1', 'margin:0 0 0 -4mm',
      'box-shadow:0 1mm 2mm rgba(0,0,0,0.2)', 'text-shadow:0 0 1px #000', 'background:linear-gradient(90deg, #fff, #eee)',
      'background-image:radial-gradient(circle, #fff 0%, #ddd 100%)', 'visibility:hidden', 'font-size:96pt', 'line-height:8',
    ]) {
      expect(declarations(declaration), declaration).toBe(declaration);
    }
  });

  it('bounds a negative number like a positive one', () => {
    expect(declarations('text-indent:-401mm')).toBe('');
    expect(declarations('text-indent:-11mm')).toBe('text-indent:-11mm');
  });

  it('refuses a line break inside quoted text, so nothing after it is read as a declaration', () => {
    for (const breaker of ['\n', '\r', '\f']) {
      const css = `p{content:"b${breaker};filter:blur(3px);transform:rotate(45deg);background-image:url(https://evil.example/x.png);x:"}`;
      expect(sheet(css), JSON.stringify(breaker)).toBe('');
      expect(declarations(`content:"b${breaker};filter:blur(3px)"`)).toBe('');
    }
  });

  it('keeps comment-like text inside quotes and still removes real comments', () => {
    expect(sheet('p::before{content:"/* Choose one */"}')).toBe('.qp-body p::before{content:"/* Choose one */"}');
    expect(declarations('/* it\'s */color:red;content:"a /* b */"')).toBe('color:red;content:"a /* b */"');
  });

  it('still refuses what loads or moves', () => {
    // `fixed` repeats on every printed page but shows once in the preview, so it is refused.
    expect(declarations('position:fixed;bottom:0;color:red')).toBe('bottom:0;color:red');
    for (const declaration of ['background-image:url(https://example.com/a.png)', 'background:url(x)', 'transform:rotate(3deg)', 'filter:blur(2px)', 'animation:spin 1s', 'content:attr(class)']) {
      expect(declarations(declaration), declaration).toBe('');
    }
  });
});

describe('work is linear in the input (M2, m2): no pattern backtracks over a long run', () => {
  const timed = (action: () => unknown) => {
    const started = performance.now();
    action();
    return performance.now() - started;
  };

  it.each([
    ['spaces before a bang', `color:red${' '.repeat(200_000)}!x`],
    ['spaces after a bang', `color:red !${' '.repeat(200_000)}x`],
    ['semicolons', ';'.repeat(200_000)],
    ['comment openers', '/*'.repeat(100_000)],
  ])('cleans a 200,000 character style attribute of %s in well under a second', (_name, text) => {
    expect(timed(() => declarations(text))).toBeLessThan(500);
    expect(declarations(text)).toBe('');
  });

  it('refuses a declaration list over the cap before reading it, and a value over the cap before parsing it', () => {
    const report = new StripReport();
    expect(cleanDeclarations(`color:red;${'margin:1mm;'.repeat(400)}`, report)).toBe('');
    expect(report.lines().join()).toContain('longer than 4,000 characters');
    expect(declarations(`color:red${' '.repeat(2_000)}!x`)).toBe('');
  });

  it('strips one trailing !important, with any spacing, and nothing else', () => {
    expect(declarations('color:red !important')).toBe('color:red');
    expect(declarations('color:red!IMPORTANT  ')).toBe('color:red');
    expect(declarations('color:red ! important')).toBe('color:red');
    expect(declarations('color:red !importantly')).toBe('color:red !importantly'); // not the keyword: left as written (an invalid declaration to the browser)
  });

  it.each([
    ['at-rules ending in a semicolon', '@a;'.repeat(19_700)],
    ['empty at-rule blocks', '@a{}'.repeat(14_700)],
    ['closing braces', '}'.repeat(59_000)],
    ['empty rules', 'a{}'.repeat(19_700)],
    ['unclosed rules', 'a{'.repeat(29_000)],
  ])('cleans a 59,000 character stylesheet of %s in well under a second', (_name, css) => {
    expect(timed(() => sheet(css))).toBeLessThan(500);
  });
});
