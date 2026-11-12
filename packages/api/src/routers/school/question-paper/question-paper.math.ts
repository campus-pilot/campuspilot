import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { QUESTION_PAPER_LIMITS as L } from '@campuspilot/question-paper/limits';
import katex from 'katex';

/**
 * Server-side KaTeX for question papers (design C3, C7).
 *
 * KaTeX runs inside a request on LaTeX text a model wrote (the `data-math`
 * attribute of an empty span; the model never writes the typeset markup), so it
 * is configured as tightly as it allows: no trust (no links, no `\href`, no raw
 * HTML), no macros, a bounded size and macro expansion, and HTML output only (the
 * MathML twin KaTeX adds by default would double every formula's text). The number
 * of formulas and their length are capped here and by the sanitiser; this file
 * adds a wall-clock budget.
 *
 * This is the first of the two things inserted AFTER sanitising (the other is
 * the figure data URIs): KaTeX output is trusted because our code produced it
 * from a plain string. Nothing the model wrote besides that string reaches it.
 */
const KATEX_OPTIONS = {
  output: 'html',
  throwOnError: true,
  strict: 'ignore',
  trust: false,
  maxSize: 10,
  maxExpand: 1000,
} as const;

/** How long one validation or render may spend in KaTeX before the remaining formulas are refused. */
export const MATH_WALL_BUDGET_MS = 2_000;

/** The wall-clock budget of a {@link MathRenderer} ran out. */
export class MathBudgetError extends Error {
  constructor() {
    super('This paper has too many or too complex formulas to typeset.');
  }
}

export type MathRenderer = {
  /** HTML for one formula, or throws a KaTeX `ParseError` for invalid TeX or a {@link MathBudgetError}. */
  render: (tex: string, display: boolean) => string;
  /**
   * The HTML bytes of every `render` call so far, a repeated formula counted
   * each time it is printed. Lets a check refuse a paper whose formulas alone
   * could not fit in the printed body (a 500-character nested `\sqrt` is about
   * 70 KB of KaTeX HTML).
   */
  renderedBytes: () => number;
};

/**
 * A renderer with a wall-clock budget and a memo, so validating a paper and
 * then rendering it does not typeset any formula twice. The budget is shared
 * by every formula rendered through one instance.
 */
export function createMathRenderer(budgetMs: number = MATH_WALL_BUDGET_MS): MathRenderer {
  const started = performance.now();
  const memo = new Map<string, string>();
  let bytes = 0;
  return {
    renderedBytes: () => bytes,
    render(tex, display) {
      const key = `${display ? 'd' : 'i'}:${tex}`;
      const hit = memo.get(key);
      if (hit !== undefined) {
        bytes += hit.length;
        return hit;
      }
      if (performance.now() - started > budgetMs) throw new MathBudgetError();
      // A fresh macros object every call: KaTeX writes definitions into it.
      const html = katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display, macros: {} });
      memo.set(key, html);
      bytes += html.length;
      return html;
    },
  };
}

/** What KaTeX says about a bad formula, without its "KaTeX parse error: " prefix. */
export function texErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^KaTeX parse error:\s*/, '');
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapes the five characters that matter in element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}
/** Reverses the escaping sanitize-html applies to an attribute value. */
function unescapeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export type MathSpan = { start: number; end: number; tex: string; display: boolean };

// A tag never contains `<` or `>` in sanitiser output (attribute values escape both), so `[^<>]*` reads the same tags as
// `[^>]*` there. It matters on any other input: an unclosed `<span ` repeated would make every candidate scan to the end of the
// text (quadratic), while here a scan stops at the next `<`. The lookbehind does the same for attribute names.
const OPEN_SPAN = /<span\b([^<>]*)>/g;
const SPAN_TAG = /<span\b[^<>]*>|<\/span>/g;
const ATTRIBUTE = /(?<![a-z-])([a-z][a-z-]*)="([^"]*)"/g;

/**
 * The formula spans of sanitised markup, outermost first, in document order.
 * It reads the sanitiser's output, where every attribute value is quoted and a
 * `>` inside one is escaped, so a tag ends at the first `>`. A span is
 * replaced whole, so anything a model put inside it is dropped with it.
 */
export function findMathSpans(sanitizedHtml: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let from = 0;
  for (;;) {
    OPEN_SPAN.lastIndex = from;
    const open = OPEN_SPAN.exec(sanitizedHtml);
    if (!open) return spans;
    const attributes = new Map<string, string>();
    for (const match of open[1]!.matchAll(ATTRIBUTE)) attributes.set(match[1]!, unescapeAttribute(match[2]!));
    const afterOpen = open.index + open[0].length;
    const tex = attributes.get('data-math');
    if (tex === undefined) {
      from = afterOpen;
      continue;
    }
    let depth = 1;
    let end = sanitizedHtml.length;
    SPAN_TAG.lastIndex = afterOpen;
    for (let tag = SPAN_TAG.exec(sanitizedHtml); tag; tag = SPAN_TAG.exec(sanitizedHtml)) {
      depth += tag[0] === '</span>' ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    spans.push({ start: open.index, end, tex, display: attributes.has('data-display') });
    from = end;
  }
}

export type MathFailure = { index: number; tex: string; message: string };

export type MathRendered = {
  html: string;
  /** Formulas found (typeset or not). */
  count: number;
  failures: MathFailure[];
};

/**
 * Replaces every formula span of sanitised markup with typeset KaTeX HTML. It
 * never throws: a formula KaTeX rejects, one over the length cap, one beyond the
 * count cap and every formula after the time budget ran out is printed as its
 * raw LaTeX in a marked `code` element (red in print) and listed in `failures`,
 * so the rest of the paper still prints. Callers decide what a failure means (a
 * draft check refuses the paper, a render prints and warns).
 */
export function renderMathSpans(sanitizedHtml: string, math: MathRenderer = createMathRenderer()): MathRendered {
  const spans = findMathSpans(sanitizedHtml);
  const failures: MathFailure[] = [];
  let output = '';
  let at = 0;
  spans.forEach((span, index) => {
    output += sanitizedHtml.slice(at, span.start);
    at = span.end;
    const fail = (message: string) => {
      failures.push({ index: index + 1, tex: span.tex, message });
      output += `<code class="qp-math-error">${escapeHtml(span.tex.slice(0, L.texChars))}</code>`;
    };
    if (index >= L.mathNodes) return fail(`More than ${L.mathNodes} formulas.`);
    if (span.tex.length > L.texChars) return fail(`The formula is longer than ${L.texChars} characters.`);
    try {
      const typeset = math.render(span.tex, span.display);
      output += span.display ? `<span class="qp-math-display">${typeset}</span>` : `<span class="qp-math">${typeset}</span>`;
    } catch (error) {
      fail(error instanceof MathBudgetError ? error.message : `Invalid TeX: ${texErrorMessage(error)}`);
    }
  });
  return { html: output + sanitizedHtml.slice(at), count: spans.length, failures };
}

/**
 * The KaTeX stylesheet with its fonts inlined as `data:font/woff2` URIs
 * (about 350 KB), built once per process from the pinned `katex` package.
 * The document CSP allows `font-src data:` for question papers only, so
 * nothing is fetched: the PDF converter has no network.
 *
 * The woff and ttf fallbacks of each `@font-face` are dropped: Chromium reads
 * woff2, and keeping all three would triple the size of every paper.
 */
let katexCss: string | undefined;
export function katexInlineCss(): string {
  if (katexCss !== undefined) return katexCss;
  // Module location, not an environment value: the same technique as db's migrate.ts.
  const require = createRequire(import.meta.url);
  const distDir = dirname(require.resolve('katex/dist/katex.min.css'));
  const css = readFileSync(join(distDir, 'katex.min.css'), 'utf8');
  katexCss = css.replace(
    /url\(fonts\/([^)]+\.woff2)\)\s*format\("woff2"\),\s*url\([^)]*\)\s*format\("woff"\),\s*url\([^)]*\)\s*format\("truetype"\)/g,
    (_match, file: string) =>
      `url(data:font/woff2;base64,${readFileSync(join(distDir, 'fonts', file)).toString('base64')}) format("woff2")`,
  );
  if (/url\(fonts\//.test(katexCss)) {
    throw new Error('The KaTeX stylesheet contains a font that was not inlined.');
  }
  return katexCss;
}
