import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { walkPaper, formatPath, type Path } from '@campuspilot/question-paper/walk';
import type { QuestionPaperShape } from '@campuspilot/question-paper/schema';
import { ORPCError } from '@orpc/server';
import katex from 'katex';

import { rpcError } from '../../../errors';

/**
 * Server-side KaTeX for question papers (design C3, C7).
 *
 * KaTeX runs inside a request on text an agent or a model wrote, so it is
 * configured as tightly as it allows: no trust (no links, no `\href`, no
 * raw HTML), no macros, a bounded size and macro expansion, and HTML output
 * only (the MathML twin KaTeX adds by default would double every formula's
 * text in the sanitiser-free body). The number of formulas and their length
 * are bounded by the document schema; this file adds a wall-clock budget.
 */
const KATEX_OPTIONS = {
  output: 'html',
  throwOnError: true,
  strict: 'ignore',
  trust: false,
  maxSize: 10,
  maxExpand: 1000,
} as const;

/** How long one validation or render may spend in KaTeX before it is refused. */
export const MATH_WALL_BUDGET_MS = 2_000;

export type MathRenderer = {
  /** HTML for one formula, or throws a KaTeX `ParseError` for invalid TeX. */
  render: (tex: string, display: boolean) => string;
  /**
   * The HTML bytes of every `render` call so far, a repeated formula counted
   * each time it is printed. Lets a draft check refuse a paper whose formulas
   * alone could not fit in the printed body (a 500-character nested `\sqrt`
   * is about 70 KB of KaTeX HTML).
   */
  renderedBytes: () => number;
};

/**
 * A renderer with a wall-clock budget and a memo, so validating a paper and
 * then rendering it does not typeset any formula twice. The budget is shared
 * by every formula rendered through one instance and exhausting it is a
 * BAD_REQUEST, never a hang.
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
      if (performance.now() - started > budgetMs) {
        throw rpcError.badRequest('This paper is too complex to render. Split it into smaller sections.');
      }
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

export type MathIssue = { path: string; message: string };

/**
 * Every formula of a paper that KaTeX rejects, with the path of the run so a
 * model can fix exactly that formula. A budget overrun throws instead.
 */
export function validatePaperMath(paper: QuestionPaperShape, math: MathRenderer = createMathRenderer()): MathIssue[] {
  const issues: MathIssue[] = [];
  walkPaper(paper, {
    richText(value, path: Path) {
      if (typeof value === 'string') return;
      value.forEach((run, index) => {
        if (typeof run === 'string' || run.t !== 'math') return;
        try {
          math.render(run.tex, run.display === true);
        } catch (error) {
          if (error instanceof ORPCError) throw error;
          issues.push({ path: formatPath([...path, index]), message: `Invalid TeX: ${texErrorMessage(error)}` });
        }
      });
    },
  });
  return issues;
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
