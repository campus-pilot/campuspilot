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

  it('cannot reach the page or pseudo states, and header/footer elements are not known elements of a paper', () => {
    for (const selector of ['body', 'html', ':root', 'header', 'main', 'p:not(.x)', 'p:hover', 'p::before', '[href]']) {
      expect(sheet(`${selector}{color:red}`), selector).toBe('');
    }
    expect(body('header{display:none}footer{display:none}')).toBe('<p>x</p>');
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
    ['line-height above 5', 'line-height:6'],
    ['huge grid repeat', 'grid-template-rows:repeat(99999,100px)'],
    ['grid repeat above 12', 'grid-template-columns:repeat(13,1fr)'],
    ['many grid tracks', `grid-template-columns:${'1fr '.repeat(41)}`],
    ['huge columns', 'columns:99999'],
    ['huge column-count', 'column-count:7'],
    ['huge tab-size', 'tab-size:99999999'],
    ['huge flex', 'flex:99999'],
    ['huge orphans', 'orphans:99999'],
    ['huge grid line', 'grid-row:1 / 99999'],
    ['huge font size', 'font-size:100em'],
    ['font size in points', 'font-size:200pt'],
    ['huge height', 'height:99999mm'],
    ['unknown unit', 'height:5dvh'],
    ['negative margin', 'margin-top:-100000'],
    ['small negative margin', 'margin:0 0 0 -1mm'],
    ['negative top', 'top:-100vh'],
    ['negative padding via shorthand', 'padding:-5mm'],
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

  it('removes top/right/bottom/left offsets and keeps position:relative harmless (m1)', () => {
    expect(declarations('top:2mm')).toBe('');
    expect(declarations('left:0')).toBe('');
    expect(declarations('position:relative;top:2mm;color:red')).toBe('position:relative;color:red');
    expect(declarations('position:sticky')).toBe('');
  });

  it('negative text-indent and vertical-align are bounded to a hanging indent', () => {
    expect(declarations('text-indent:-400mm')).toBe('');
    expect(declarations('text-indent:-10mm')).toBe('text-indent:-10mm');
    expect(declarations('text-indent:-11mm')).toBe('');
  });
});
