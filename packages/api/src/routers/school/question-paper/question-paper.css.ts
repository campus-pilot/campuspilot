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
 * - Layout is the author's (a decision of the product owner, 2026-11-14):
 *   any `position`, offsets, `z-index`, negative margins, shadows, gradients,
 *   `::before`/`::after` with `content`, and large text are allowed. A label
 *   laid over a figure needs them, and the teacher sees the paper as it prints
 *   and approves every save, so a layout that covers the school's heading is
 *   seen and refused by a person, not by this file. What stays out is what
 *   loads, runs or moves, and what reaches outside the paper's own elements.
 * - Every number is checked, not only lengths with a unit: no `calc()`,
 *   `min()`, `max()`, `clamp()`, `var()` or `env()` (they compute sizes the
 *   caps cannot see), no exponent notation, a cap per unit near an A4 page,
 *   and a cap per property for unitless numbers (`line-height`, `columns`,
 *   `flex`, grid `repeat()` counts...). A rule therefore cannot ask for an
 *   unbounded number of pages. The converter's page cap is the second line
 *   of defence (many small allowed rules can still add up).
 * - Every selector is rebuilt from validated parts and prefixed with the body
 *   wrapper class and a DESCENDANT combinator, so a rule matches only inside
 *   the paper and can never restyle the school's heading or footer (a sibling
 *   combinator after the wrapper, `.qp-body ~ *`, is not accepted). A selector
 *   that an earlier pass already prefixed has that ONE prefix removed before it
 *   is parsed and is then prefixed again, which makes cleaning idempotent
 *   (stored fragments are cleaned again at render time). A selector may not name
 *   a class reserved by the page (see {@link RESERVED_CLASS}).
 */

/** The class of the wrapper element the fragment is placed in. Also written by the renderer. */
export const QUESTION_PAPER_BODY_CLASS = 'qp-body';

/**
 * Class names the renderer, KaTeX and the built-in templates define styles
 * for (`qp-*` renderer classes, `qpc-*` and `qpk-*` template classes, `katex*`,
 * `question-paper*` the page frame). A fragment cannot use them in `class`
 * attributes or selectors: borrowing `qpc-foot` would, for example, give a model
 * the template's fixed footer. The built-in designs' classes all start with one
 * of these prefixes (`question-paper.css.test.ts` checks the catalogue).
 */
export const RESERVED_CLASS = /^(?:qp|katex|question-paper)/i;

/** Collects what was dropped, as short readable lines with counts. */
export class StripReport {
  private readonly counts = new Map<string, number>();

  add(message: string) {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  /** Adds the messages of `other` that this report does not have yet (counts of the first pass are the ones kept). */
  mergeNew(other: StripReport) {
    for (const message of other.counts.keys()) if (!this.counts.has(message)) this.counts.set(message, other.counts.get(message)!);
  }

  lines(): string[] {
    return [...this.counts].map(([message, count]) => (count > 1 ? `${message} (${count} times)` : message));
  }
}

const MOTION_PROPERTY = /^(animation|transition|will-change|offset|scroll-timeline|view-timeline|motion)(-|$)/;

/** Presentation and layout properties, by name. Anything else is dropped. */
const PROPERTIES = new Set(
  [
    'display', 'position', 'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
    'top', 'right', 'bottom', 'left', 'inset', 'inset-inline', 'inset-inline-start', 'inset-inline-end', 'inset-block', 'inset-block-start', 'inset-block-end', 'z-index',
    'visibility', 'box-shadow', 'text-shadow', 'content', 'counter-reset', 'counter-increment', 'quotes',
    'background-image', 'background-size', 'background-position', 'background-repeat', 'background-origin', 'background-clip',
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
  position: /^(static|relative|absolute|fixed|sticky)$/i,
  visibility: /^(visible|hidden|collapse)$/i,
  float: /^(left|right|none|inline-start|inline-end)$/i,
  clear: /^(left|right|both|none)$/i,
  overflow: /^(visible|hidden)(\s+(visible|hidden))?$/i,
  'overflow-x': /^(visible|hidden)$/i,
  'overflow-y': /^(visible|hidden)$/i,
};

/** Fonts the PDF converter has, plus the generic families (Chromium falls back by script for the rest). */
const FONT_FAMILY = /^(noto (sans|serif)( [a-z ]{1,30})?|dejavu (sans|serif)( mono)?|liberation (sans|serif|mono)|serif|sans-serif|monospace|arial|helvetica|times new roman|times|courier new|courier|georgia|verdana|system-ui)$/i;

/** Largest magnitude of a length, by unit, near an A4 page. Larger values would only make runaway layouts. */
export const UNIT_CAP: Record<string, number> = {
  mm: 400, cm: 40, q: 1600, in: 16, pt: 1100, pc: 90, px: 1500, em: 100, rem: 100, ex: 100, ch: 100, vh: 100, vw: 100, vmin: 100, vmax: 100, '%': 400, fr: 12,
  // Angles, for gradients.
  deg: 360, grad: 400, rad: 7, turn: 1,
};

/** Largest unitless number by property (everything else: {@link DEFAULT_UNITLESS_CAP}). */
const UNITLESS_CAP: Record<string, number> = {
  flex: 20, 'flex-grow': 20, 'flex-shrink': 20, 'flex-basis': 0,
  columns: 6, 'column-count': 6,
  'tab-size': 16,
  orphans: 10, widows: 10,
  opacity: 1, 'fill-opacity': 1, 'stroke-opacity': 1,
  'aspect-ratio': 20,
  'font-weight': 1000,
  'stroke-width': 100, 'stroke-dasharray': 1000, 'stroke-dashoffset': 1000,
  'grid-template-columns': 12, 'grid-template-rows': 12, 'grid-auto-columns': 12, 'grid-auto-rows': 12,
  'grid-area': 12, 'grid-column': 12, 'grid-row': 12,
};
const DEFAULT_UNITLESS_CAP = 1000;

/**
 * Functions a value may call: colours, gradients, counters and the grid's own. `calc`, `min`, `max`, `clamp`, `var`,
 * `env`, `attr` and `url`... compute or fetch what the caps cannot see.
 */
const ALLOWED_FUNCTIONS = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'repeat', 'minmax',
  'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
  'counter', 'counters',
]);
const GRID_FUNCTION_PROPERTIES = new Set(['grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows']);
/** Most whitespace-separated tokens in a grid track list. */
const MAX_GRID_TOKENS = 40;

const VALUE_CHARS = /^[A-Za-z0-9 #.,%()\-/'"!_]*$/;
const FORBIDDEN_IN_VALUE = /url\s*\(|image-set|image\s*\(|src\s*\(|element\s*\(|expression|javascript|@import|-moz-binding|behavior/i;
const MAX_VALUE_CHARS = 300;
/**
 * The most characters of one declaration list (a `style` attribute or the body of one rule). It is checked BEFORE
 * anything else looks at the text, so no scan below ever runs over more than this, whatever the input.
 */
const MAX_DECLARATIONS_CHARS = 4_000;

/** Removes a trailing `!important` (any spacing) from an already trimmed value. Linear: no backtracking pattern. */
function withoutImportant(value: string): string {
  const bang = value.lastIndexOf('!');
  if (bang < 0 || value.slice(bang + 1).trim().toLowerCase() !== 'important') return value;
  return value.slice(0, bang).trimEnd();
}

/** Strings, hex colours, identifiers and numbers (with optional exponent and unit) of a value, in order. */
const VALUE_TOKEN = /"[^"]*"|'[^']*'|#[0-9a-fA-F]+|([+-]?(?:\d+\.?\d*|\.\d+))([eE][+-]?\d+)?([a-zA-Z%]*)|[a-zA-Z_-][a-zA-Z0-9_-]*/g;

/** Why a value is not acceptable for a property, or null when it is. */
function valueProblem(property: string, rawValue: string): string | null {
  // The length is capped before any other work: `!important` may add a few characters and spaces around it are trimmed.
  const trimmed = rawValue.trim();
  if (trimmed.length > MAX_VALUE_CHARS + 20) return 'its value is empty or too long';
  const value = withoutImportant(trimmed);
  if (value === '' || value.length > MAX_VALUE_CHARS) return 'its value is empty or too long';
  // Quoted text (`content: "→ "`) may hold any character except what could end the style or reopen markup.
  const strings = [...value.matchAll(/"[^"]*"|'[^']*'/g)].map((match) => match[0]);
  if (strings.some((text) => /[<>&{}@\\]/.test(text))) return 'its text is not allowed';
  const unquoted = property === 'content' || property === 'quotes' ? value.replace(/"[^"]*"|'[^']*'/g, '""') : value;
  if (!VALUE_CHARS.test(unquoted) || FORBIDDEN_IN_VALUE.test(unquoted)) return 'its value is not allowed';
  for (const call of unquoted.matchAll(/([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\(/g)) {
    const name = call[1]!.toLowerCase();
    if (!ALLOWED_FUNCTIONS.has(name) || ((name === 'repeat' || name === 'minmax') && !GRID_FUNCTION_PROPERTIES.has(property))) {
      return `the function ${name}() is not allowed (write the size as a plain number with a unit)`;
    }
  }
  if (GRID_FUNCTION_PROPERTIES.has(property) && value.split(/[\s,()]+/).filter(Boolean).length > MAX_GRID_TOKENS) return 'it lists too many grid tracks';
  const unitless = UNITLESS_CAP[property] ?? DEFAULT_UNITLESS_CAP;
  for (const token of unquoted.matchAll(VALUE_TOKEN)) {
    if (token[1] === undefined) continue;
    if (token[2] !== undefined) return 'scientific notation (1e3) is not allowed';
    const amount = Number(token[1]);
    const unit = token[3]!.toLowerCase();
    if (unit === '') {
      if (Math.abs(amount) > unitless) return 'a number in it is far larger than a page needs';
    } else {
      const cap = UNIT_CAP[unit];
      if (cap === undefined) return `the unit "${unit}" is not allowed`;
      if (Math.abs(amount) > cap) return 'a length in it is far larger than a page';
    }
  }
  const keyword = KEYWORDS[property];
  if (keyword && !keyword.test(value)) return 'its value is not allowed';
  if (property === 'font-family') {
    const families = value.split(',').map((name) => name.trim().replace(/^(["'])(.*)\1$/, '$2').trim());
    if (!families.every((name) => FONT_FAMILY.test(name))) return 'the font is not installed';
  }
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
  if (text.length > MAX_DECLARATIONS_CHARS) {
    report.add(`A style longer than ${MAX_DECLARATIONS_CHARS.toLocaleString('en-IN')} characters was removed`);
    return '';
  }
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
    kept.push(`${property}:${withoutImportant(value)}`);
  }
  return kept.join(';');
}

const PSEUDO = '(?:first-child|last-child|only-child|first-of-type|last-of-type|only-of-type|empty|hover|focus|focus-within|active)';
/** Pseudo-elements (and their old one-colon spelling). They draw from the element's own `content`; nothing about them moves. */
const PSEUDO_ELEMENT = '(?::?:(?:before|after)|::(?:marker|first-letter|first-line|selection))';
const NTH = '(?:nth-child|nth-last-child|nth-of-type|nth-last-of-type)\\((?:odd|even|[0-9n+\\- ]{1,12})\\)';
const COMPOUND = new RegExp(
  '^(?:' +
    [
      '\\*',
      '[a-zA-Z][a-zA-Z0-9]*',
      '\\.[a-zA-Z_][a-zA-Z0-9_-]*',
      PSEUDO_ELEMENT,
      `:${PSEUDO}`,
      `:${NTH}`,
      ':lang\\([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,8})?\\)',
      '\\[(?:lang|dir|colspan|rowspan|scope|type|start)(?:[~|^$*]?=(?:"[a-zA-Z0-9_ -]{0,40}"|\'[a-zA-Z0-9_ -]{0,40}\'|[a-zA-Z0-9_-]{1,40}))?\\]',
    ].join('|') +
    ')',
);
const COMBINATOR = /^\s*([>+~])\s*|^\s+/;

/** A logical pseudo-class whose argument is itself a selector list (`:not(.a, p)`). */
const LOGICAL = /^:(not|is|where)\(/i;

/**
 * The argument of a logical pseudo-class at the start of `rest`, rebuilt from
 * validated parts (one level deep, never prefixed: it qualifies an element
 * that the outer selector already places inside the paper), with the length
 * of the text it used; null when any part is not recognised.
 */
function logicalPseudo(rest: string, knownElement: (name: string) => boolean, nested: boolean): { text: string; length: number } | null {
  const head = LOGICAL.exec(rest);
  if (!head || nested) return null;
  let depth = 0;
  let end = -1;
  for (let index = head[0].length - 1; index < rest.length; index += 1) {
    if (rest[index] === '(') depth += 1;
    else if (rest[index] === ')' && --depth === 0) {
      end = index;
      break;
    }
  }
  if (end < 0) return null;
  const inner = rest.slice(head[0].length, end).split(',').map((part) => rebuildSelector(part, knownElement, true));
  if (inner.some((part) => part === null)) return null;
  return { text: `:${head[1]!.toLowerCase()}(${inner.join(',')})`, length: end + 1 };
}

/**
 * The selector rebuilt from its validated parts, or null when any part is not
 * recognised. `knownElement` decides which element names may appear;
 * `nested` is true inside a logical pseudo-class, where another one is not
 * accepted.
 */
function rebuildSelector(selector: string, knownElement: (name: string) => boolean, nested: boolean): string | null {
  let rest = selector.trim();
  if (rest === '' || rest.length > 200) return null;
  let rebuilt = '';
  let expectCompound = true;
  while (rest.length > 0) {
    if (expectCompound) {
      const logical = logicalPseudo(rest, knownElement, nested);
      if (logical) {
        rebuilt += logical.text;
        rest = rest.slice(logical.length);
        if (rest.length > 0 && !/^[\s>+~]/.test(rest)) {
          if (/^[a-zA-Z*]/.test(rest)) return null;
          continue;
        }
        expectCompound = false;
        continue;
      }
      const part = COMPOUND.exec(rest);
      if (!part) return null;
      const text = part[0];
      if (/^[a-zA-Z]/.test(text) && !knownElement(text.toLowerCase())) return null;
      if (text.startsWith('.') && RESERVED_CLASS.test(text.slice(1))) return null;
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
  return rebuilt;
}

/**
 * The selector rebuilt from its validated parts, prefixed with the body
 * wrapper class, or null when any part is not recognised.
 */
function scopeSelector(selector: string, knownElement: (name: string) => boolean): string | null {
  // A selector an earlier pass prefixed: remove that ONE descendant prefix and parse the rest as written. A wrapper
  // followed by anything else (`.qp-body ~ *`, `.qp-body + p`, `.qp-body > p`, `.qp-body.x`, a bare `.qp-body`) is not
  // a prefix; it falls through, fails the parse (a combinator cannot start a selector) or names a reserved class.
  const rest = selector.trim().replace(new RegExp(`^\\.${QUESTION_PAPER_BODY_CLASS}\\s+`), '');
  const rebuilt = rebuildSelector(rest, knownElement, false);
  return rebuilt === null ? null : `.${QUESTION_PAPER_BODY_CLASS} ${rebuilt}`;
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
    // Commas inside `:is(...)` / `:not(...)` belong to the argument, not the rule's list.
    const selectors = (splitTopLevel(prelude, ',') ?? [prelude, '']).map((selector) => scopeSelector(selector, knownElement));
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

/**
 * Index after an at-rule: after its `;`, or after its balanced `{...}` block, whichever comes first. One forward scan
 * that stops at the first `;` or `{` outside quotes, so a long run of at-rules is scanned once, not once per at-rule.
 */
function skipAtRule(text: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ';') return index + 1;
    else if (char === '{') {
      const close = matchingBrace(text, index);
      return close < 0 ? text.length : close + 1;
    }
  }
  return text.length;
}
