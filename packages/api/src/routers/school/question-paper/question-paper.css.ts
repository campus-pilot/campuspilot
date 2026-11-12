/**
 * The CSS half of the `question_paper_body` sanitiser profile
 * (`question-paper.sanitize.ts`).
 *
 * The CSS comes from a model that photographs and prompts can steer, so this
 * is an ALLOWLIST: a property, a selector shape or a value this file does not
 * recognise is dropped and reported, never passed through. Nothing here
 * evaluates or rewrites CSS beyond dropping and prefixing.
 *
 * What cannot get through, and why:
 * - No at-rule of any kind (`@import`, `@font-face`, `@keyframes`, `@media`,
 *   `@page`...): they fetch resources, define motion or reach outside the
 *   body. All are dropped whole.
 * - No `url(`, `image-set(`, `src(`, `element(`, `var(`, `attr(`, backslash
 *   (CSS escapes could spell `url`), `<`, `>`, braces or `@` inside a value.
 * - No `animation*`, `transition*`, `will-change`, `transform`, `filter` or
 *   `offset*` property: a paper is printed, nothing moves. Dropped properties
 *   of the motion family are reported with their own wording.
 * - `position` is `static` or `relative` only and there is no `z-index`, so a
 *   rule cannot paint over the school's fixed footer band.
 * - Lengths are capped near an A4 page, so a rule cannot create an unbounded
 *   number of pages.
 * - Every selector is prefixed with the body wrapper class, so a rule matches
 *   only inside the paper and can never restyle the school's heading or footer;
 *   selectors are rebuilt from validated parts, not passed through. A selector
 *   that already starts with the wrapper class and a descendant combinator keeps
 *   its single prefix, which makes cleaning idempotent (stored fragments are
 *   cleaned again at render time).
 */

/** The class of the wrapper element the fragment is placed in. Also written by the renderer. */
export const QUESTION_PAPER_BODY_CLASS = 'qp-body';

/** Collects what was dropped, as short readable lines with counts. */
export class StripReport {
  private readonly counts = new Map<string, number>();

  add(message: string) {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  lines(): string[] {
    return [...this.counts].map(([message, count]) => (count > 1 ? `${message} (${count} times)` : message));
  }
}

const MOTION_PROPERTY = /^(animation|transition|will-change|offset|scroll-timeline|view-timeline|motion)(-|$)/;

/** Presentation and layout properties, by name. Anything else is dropped. */
const PROPERTIES = new Set(
  [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
    'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-basis',
    'align-items', 'align-content', 'align-self', 'justify-content', 'justify-items', 'justify-self', 'place-items', 'place-content',
    'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-area', 'grid-column', 'grid-row', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing', 'aspect-ratio',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-inline-start', 'margin-inline-end', 'margin-block', 'margin-block-start', 'margin-block-end',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-inline-start', 'padding-inline-end', 'padding-block', 'padding-block-start', 'padding-block-end',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-inline', 'border-inline-start', 'border-inline-end', 'border-block', 'border-block-start', 'border-block-end',
    'border-width', 'border-style', 'border-color', 'border-radius', 'border-collapse', 'border-spacing',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
    'color', 'background', 'background-color', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant-numeric',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-align-last', 'text-indent', 'text-transform',
    'text-decoration', 'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset',
    'vertical-align', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'unicode-bidi', 'tab-size',
    'list-style', 'list-style-type', 'list-style-position',
    'break-inside', 'break-before', 'break-after', 'page-break-inside', 'page-break-before', 'page-break-after', 'orphans', 'widows',
    'table-layout', 'caption-side', 'empty-cells', 'columns', 'column-count', 'column-width', 'column-rule', 'column-fill', 'object-fit', 'object-position',
    'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'text-anchor', 'dominant-baseline',
  ],
);

const KEYWORDS: Record<string, RegExp> = {
  display: /^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|inline-table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-caption|list-item|none|contents)$/i,
  position: /^(static|relative)$/i,
  float: /^(left|right|none|inline-start|inline-end)$/i,
  clear: /^(left|right|both|none)$/i,
  overflow: /^(visible|hidden)(\s+(visible|hidden))?$/i,
  'overflow-x': /^(visible|hidden)$/i,
  'overflow-y': /^(visible|hidden)$/i,
};

/** Fonts the PDF converter has, plus the generic families (Chromium falls back by script for the rest). */
const FONT_FAMILY = /^(noto (sans|serif)( [a-z ]{1,30})?|dejavu (sans|serif)( mono)?|liberation (sans|serif|mono)|serif|sans-serif|monospace|arial|helvetica|times new roman|times|courier new|courier|georgia|verdana|system-ui)$/i;

/** Largest magnitude of a length, by unit, near an A4 page. Larger values would only make runaway layouts. */
const UNIT_CAP: Record<string, number> = { mm: 400, cm: 40, q: 1600, in: 16, pt: 1100, pc: 90, px: 1500, em: 100, rem: 100, ex: 100, ch: 100, vh: 100, vw: 100, vmin: 100, vmax: 100, '%': 400 };

const VALUE_CHARS = /^[A-Za-z0-9 #.,%()+\-*/'"!_]*$/;
const FORBIDDEN_IN_VALUE = /url\s*\(|image-set|image\s*\(|src\s*\(|element\s*\(|var\s*\(|attr\s*\(|env\s*\(|expression|javascript|@import|-moz-binding|behavior/i;
const MAX_VALUE_CHARS = 300;

/** Why a value is not acceptable for a property, or null when it is. */
function valueProblem(property: string, rawValue: string): string | null {
  const value = rawValue.replace(/\s*!\s*important\s*$/i, '').trim();
  if (value === '' || value.length > MAX_VALUE_CHARS) return 'its value is empty or too long';
  if (!VALUE_CHARS.test(value) || FORBIDDEN_IN_VALUE.test(value)) return 'its value is not allowed';
  for (const match of value.matchAll(/(-?\d*\.?\d+)(mm|cm|q|in|pt|pc|px|rem|em|ex|ch|vh|vw|vmin|vmax|%)(?![a-z])/gi)) {
    const cap = UNIT_CAP[match[2]!.toLowerCase()];
    if (cap !== undefined && Math.abs(Number(match[1])) > cap) return 'a length in it is far larger than a page';
  }
  const keyword = KEYWORDS[property];
  if (keyword && !keyword.test(value)) return 'its value is not allowed';
  if (property === 'font-family') {
    const families = value.split(',').map((name) => name.trim().replace(/^(["'])(.*)\1$/, '$2').trim());
    if (!families.every((name) => FONT_FAMILY.test(name))) return 'the font is not installed';
  }
  if ((property === 'background' || property === 'background-color') && /gradient|none\s+\S/i.test(value)) return 'only a plain background colour is allowed';
  return null;
}

/**
 * Splits at `separator` outside parentheses and quotes. Returns null when the
 * text has an unbalanced parenthesis or an unterminated quote.
 */
function splitTopLevel(text: string, separator: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0 || quote) return null;
  parts.push(text.slice(start));
  return parts;
}

/**
 * Cleans the declarations of one rule or one `style=""` attribute: the
 * accepted ones joined with `;`, in their original order. Dropped ones are
 * reported by property name.
 */
export function cleanDeclarations(text: string, report: StripReport): string {
  if (text.includes('\\')) {
    report.add('A style containing a backslash escape was removed');
    return '';
  }
  const declarations = splitTopLevel(text.replace(/\/\*[\s\S]*?(\*\/|$)/g, ''), ';');
  if (!declarations) {
    report.add('A style with unbalanced brackets or quotes was removed');
    return '';
  }
  const kept: string[] = [];
  for (const declaration of declarations) {
    if (declaration.trim() === '') continue;
    const colon = declaration.indexOf(':');
    const property = colon < 0 ? '' : declaration.slice(0, colon).trim().toLowerCase();
    if (!/^[a-z][a-z-]*$/.test(property)) {
      report.add('A malformed style declaration was removed');
      continue;
    }
    if (MOTION_PROPERTY.test(property)) {
      report.add(`Animation or motion CSS "${property}" was removed (a paper is printed, nothing moves)`);
      continue;
    }
    if (!PROPERTIES.has(property)) {
      report.add(`The CSS property "${property}" is not allowed and was removed`);
      continue;
    }
    const value = declaration.slice(colon + 1).trim();
    const problem = valueProblem(property, value);
    if (problem) {
      report.add(`The CSS "${property}" was removed: ${problem}`);
      continue;
    }
    kept.push(`${property}:${value.replace(/\s*!\s*important\s*$/i, '').trim()}`);
  }
  return kept.join(';');
}

const PSEUDO = '(?:first-child|last-child|only-child|first-of-type|last-of-type|only-of-type|empty)';
const NTH = '(?:nth-child|nth-last-child|nth-of-type|nth-last-of-type)\\((?:odd|even|[0-9n+\\- ]{1,12})\\)';
const COMPOUND = new RegExp(
  '^(?:' +
    [
      '\\*',
      '[a-zA-Z][a-zA-Z0-9]*',
      '\\.[a-zA-Z_][a-zA-Z0-9_-]*',
      `:${PSEUDO}`,
      `:${NTH}`,
      ':lang\\([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,8})?\\)',
      '\\[(?:lang|dir|class|colspan|rowspan|scope|type|start)(?:[~|^$*]?=(?:"[a-zA-Z0-9_ -]{0,40}"|\'[a-zA-Z0-9_ -]{0,40}\'|[a-zA-Z0-9_-]{1,40}))?\\]',
    ].join('|') +
    ')',
);
const COMBINATOR = /^\s*([>+~])\s*|^\s+/;

/**
 * The selector rebuilt from its validated parts, prefixed with the body
 * wrapper class, or null when any part is not recognised. `knownElement`
 * decides which element names may appear.
 */
function scopeSelector(selector: string, knownElement: (name: string) => boolean): string | null {
  let rest = selector.trim();
  if (rest === '' || rest.length > 200) return null;
  // The wrapper itself is not a target: only what is inside it.
  if (new RegExp(`^\\.${QUESTION_PAPER_BODY_CLASS}(?:[^\\s>+~]|$)`).test(rest)) return null;
  let rebuilt = '';
  let expectCompound = true;
  while (rest.length > 0) {
    if (expectCompound) {
      const part = COMPOUND.exec(rest);
      if (!part) return null;
      const text = part[0];
      if (/^[a-zA-Z]/.test(text) && !knownElement(text.toLowerCase())) return null;
      rebuilt += text;
      rest = rest.slice(text.length);
      // A compound selector continues with more simple selectors until a combinator.
      if (rest.length > 0 && !/^[\s>+~]/.test(rest)) {
        if (/^[a-zA-Z*]/.test(rest)) return null;
        continue;
      }
      expectCompound = false;
    } else {
      const combinator = COMBINATOR.exec(rest);
      if (!combinator) return null;
      rebuilt += combinator[1] ? ` ${combinator[1]} ` : ' ';
      rest = rest.slice(combinator[0].length);
      expectCompound = true;
    }
  }
  if (expectCompound) return null;
  // Idempotence: a selector that is already scoped (the output of an earlier pass, or written that way) keeps its one prefix.
  return rebuilt.startsWith(`.${QUESTION_PAPER_BODY_CLASS} `) || rebuilt.startsWith(`.${QUESTION_PAPER_BODY_CLASS} >`) ? rebuilt : `.${QUESTION_PAPER_BODY_CLASS} ${rebuilt}`;
}

/**
 * Cleans the text of a `<style>` element: the accepted rules, each selector
 * prefixed with the body wrapper class and each declaration list cleaned by
 * {@link cleanDeclarations}. Everything else (at-rules, unknown selectors,
 * nested rules) is dropped and reported.
 */
export function cleanStyleSheet(css: string, report: StripReport, knownElement: (name: string) => boolean): string {
  if (/[<&]/.test(css)) {
    // Neither can appear in valid CSS that we accept; both could reopen markup in a foreign-content parse.
    report.add('A <style> block containing "<" or "&" was removed');
    return '';
  }
  const text = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');
  const rules: string[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index]!)) index += 1;
    if (index >= text.length) break;
    if (text[index] === '@') {
      const name = /^@[a-zA-Z-]*/.exec(text.slice(index))![0];
      report.add(
        /^@(keyframes|-webkit-keyframes|-moz-keyframes)$/i.test(name)
          ? 'Animation CSS "@keyframes" was removed (a paper is printed, nothing moves)'
          : `The CSS at-rule "${name}" is not allowed and was removed`,
      );
      index = skipAtRule(text, index);
      continue;
    }
    const open = findOutsideQuotes(text, '{', index);
    if (open < 0) {
      report.add('Unfinished CSS at the end of a <style> block was removed');
      break;
    }
    const close = matchingBrace(text, open);
    const prelude = text.slice(index, open);
    const block = text.slice(open + 1, close < 0 ? text.length : close);
    index = close < 0 ? text.length : close + 1;
    if (close < 0 || block.includes('{') || prelude.includes('}') || prelude.includes(';')) {
      report.add('A malformed or nested CSS rule was removed');
      continue;
    }
    const selectors = prelude.split(',').map((selector) => scopeSelector(selector, knownElement));
    if (selectors.some((selector) => selector === null)) {
      report.add(`The CSS selector "${prelude.trim().slice(0, 60)}" is not allowed and its rule was removed`);
      continue;
    }
    const declarations = cleanDeclarations(block, report);
    if (declarations !== '') rules.push(`${selectors.join(',')}{${declarations}}`);
  }
  return rules.join('\n');
}

function findOutsideQuotes(text: string, target: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === target) return index;
  }
  return -1;
}

/** The index of the `}` that closes the `{` at `open`, or -1 (a nested `{` counts). */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Index after an at-rule: after its `;`, or after its balanced `{...}` block, whichever comes first. */
function skipAtRule(text: string, start: number): number {
  const semicolon = findOutsideQuotes(text, ';', start);
  const open = findOutsideQuotes(text, '{', start);
  if (open < 0 || (semicolon >= 0 && semicolon < open)) return semicolon < 0 ? text.length : semicolon + 1;
  const close = matchingBrace(text, open);
  return close < 0 ? text.length : close + 1;
}
