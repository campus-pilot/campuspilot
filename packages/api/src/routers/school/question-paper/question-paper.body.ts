import type {
  Block,
  Language,
  QuestionPaper,
  QuestionPaperOption,
  RichText,
  Script,
} from '@campuspilot/question-paper/schema';
import { walkPaper } from '@campuspilot/question-paper/walk';
import { ORPCError } from '@orpc/server';

import { rpcError } from '../../../errors';
import { katexInlineCss, texErrorMessage, type MathRenderer } from './question-paper.math';

/**
 * JSON to HTML for the body of a question paper (design C7).
 *
 * SAFETY CONTRACT. The result is inserted into the PDF document WITHOUT
 * sanitising (see `QUESTION_PAPER_SLOT`), so this file is the only barrier
 * between the document JSON and the PDF converter's browser:
 *
 * 1. Every string of the JSON is passed through {@link escapeHtml} before it
 *    is written. No value is ever written as markup, an attribute name, a
 *    URL, a class name or CSS.
 * 2. Class names, `lang` values, `dir` values and font stacks come from the
 *    fixed lookup tables below, keyed by the document's enums. A key the
 *    tables do not know throws, so an unvalidated document cannot smuggle
 *    anything in through them. The only numbers written into markup are
 *    `widthPct` (an integer, checked here) and formatted marks.
 * 3. The element and class vocabulary is fixed: `div.qp-body`,
 *    `section.qp-section`, `h1.qp-title`, `h2.qp-section-heading`,
 *    `ul.qp-instructions`, `div.qp-question`, `div.qp-part`,
 *    `span.qp-number`, `div.qp-content`, `div.qp-text`, `span.qp-marks`,
 *    `ol.qp-options`, `li.qp-option`, `span.qp-option-label`,
 *    `div.qp-alternative`, `div.qp-or`, `table.qp-table`, `p.qp-paragraph`,
 *    `figure.qp-figure`, `div.qp-figure-placeholder`, `span.qp-math`,
 *    `div.qp-math-display`, `code.qp-math-error`, plus `strong em u sup sub br`.
 * 4. Images are `data:` URIs the caller built from the paper's own stored
 *    figures; this file never reads a URL from the document.
 * 5. KaTeX output is trusted markup produced from a TeX string with
 *    `trust: false`; it is inserted verbatim only inside `span.qp-math` and
 *    `div.qp-math-display`.
 * 6. The only stylesheet is generated here, from constants, plus the KaTeX
 *    stylesheet (only for papers that contain math).
 */

export const QUESTION_PAPER_BODY_MAX_BYTES = 20_000_000;
export const QUESTION_PAPER_FIGURES_MAX_BYTES = 12_000_000;

/** A figure image ready to print: a data URI built from the paper's stored figure. */
export type FigureAsset = { dataUri: string };
export type FigureAssets = ReadonlyMap<string, FigureAsset>;

export type RenderedBody = {
  html: string;
  hasMath: boolean;
  /** Uploaded figures and placeholders printed. */
  figureCount: number;
  byteSize: number;
  /** Findings that did not stop the render (a formula that failed at print time). */
  warnings: string[];
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Escapes the five characters that matter in element content and in quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}

/** The font stack of each writing system, from the Noto families installed in the PDF converter (design A9). */
const SCRIPT_FONTS = {
  latin: "'Noto Sans','DejaVu Sans',Arial,sans-serif",
  devanagari: "'Noto Sans Devanagari','Noto Sans',sans-serif",
  bengali: "'Noto Sans Bengali','Noto Sans',sans-serif",
  tamil: "'Noto Sans Tamil','Noto Sans',sans-serif",
  telugu: "'Noto Sans Telugu','Noto Sans',sans-serif",
  kannada: "'Noto Sans Kannada','Noto Sans',sans-serif",
  malayalam: "'Noto Sans Malayalam','Noto Sans',sans-serif",
  gujarati: "'Noto Sans Gujarati','Noto Sans',sans-serif",
  gurmukhi: "'Noto Sans Gurmukhi','Noto Sans',sans-serif",
  oriya: "'Noto Sans Oriya','Noto Sans',sans-serif",
  arabic: "'Noto Naskh Arabic','Noto Nastaliq Urdu','Noto Sans Arabic','Noto Sans',sans-serif",
} as const satisfies Record<Script, string>;

/** The `lang` attribute of each language; `other` states none. */
const LANG_ATTRIBUTE = {
  en: 'en', hi: 'hi', mr: 'mr', sa: 'sa', ne: 'ne', bn: 'bn', as: 'as', ta: 'ta',
  te: 'te', kn: 'kn', ml: 'ml', gu: 'gu', pa: 'pa', or: 'or', ur: 'ur', other: null,
} as const satisfies Record<Language, string | null>;

/** What is printed between a question and its "OR" alternative, in the paper's language. */
const OR_LABEL = {
  en: 'OR', hi: 'अथवा', mr: 'अथवा', sa: 'अथवा', ne: 'अथवा', bn: 'অথবা', as: 'অথবা',
  ta: 'அல்லது', te: 'లేదా', kn: 'ಅಥವಾ', ml: 'അല്ലെങ്കിൽ', gu: 'અથવા', pa: 'ਜਾਂ', or: 'ଅଥବା',
  ur: 'یا', other: 'OR',
} as const satisfies Record<Language, string>;

const FIGURE_PLACEHOLDER_LABEL = 'Figure to be added';

function lookup<T extends string>(table: Readonly<Record<T, string | null>>, key: string, what: string): string | null {
  if (!Object.hasOwn(table, key)) throw new Error(`Unknown ${what}: ${key}.`);
  return table[key as T];
}

/** Marks as printed: up to two decimals, trailing zeros trimmed. */
export function formatMarks(marks: number): string {
  return String(Number(marks.toFixed(2)));
}

type Direction = 'ltr' | 'rtl';
type Base = { language: Language; script: Script; direction: Direction };

type Context = {
  figures: FigureAssets;
  math: MathRenderer;
  base: Base;
  warnings: string[];
  state: { hasMath: boolean; figureCount: number };
};

function textRun(run: Extract<Exclude<RichText, string>[number], { t: 'text' }>, ctx: Context): string {
  let html = escapeHtml(run.v);
  if (run.sub) html = `<sub>${html}</sub>`;
  if (run.sup) html = `<sup>${html}</sup>`;
  if (run.u) html = `<u>${html}</u>`;
  if (run.i) html = `<em>${html}</em>`;
  if (run.b) html = `<strong>${html}</strong>`;
  if (run.lang === undefined && run.script === undefined && run.dir === undefined) return html;
  const attributes: string[] = [];
  if (run.script !== undefined) {
    lookup(SCRIPT_FONTS, run.script, 'script');
    attributes.push(`class="qp-script-${run.script}"`);
  }
  if (run.lang !== undefined) {
    const lang = lookup(LANG_ATTRIBUTE, run.lang, 'language');
    if (lang) attributes.push(`lang="${lang}"`);
  }
  if (run.dir !== undefined && (run.dir === 'ltr' || run.dir === 'rtl') && run.dir !== ctx.base.direction) {
    attributes.push(`dir="${run.dir}"`);
  }
  return attributes.length === 0 ? html : `<span ${attributes.join(' ')}>${html}</span>`;
}

function mathHtml(tex: string, display: boolean, ctx: Context): string {
  ctx.state.hasMath = true;
  let typeset: string;
  try {
    typeset = ctx.math.render(tex, display);
  } catch (error) {
    // Validated when saved, so this is a KaTeX upgrade changing its mind. The
    // PDF must still be produced: print the TeX itself and report it.
    if (error instanceof ORPCError) throw error;
    ctx.warnings.push(`A formula could not be typeset: ${texErrorMessage(error)}`);
    return `<code class="qp-math-error">${escapeHtml(tex)}</code>`;
  }
  return display
    ? `<div class="qp-math-display">${typeset}</div>`
    : `<span class="qp-math">${typeset}</span>`;
}

/** Rich text as inline HTML (runs, formulas and line breaks). */
function richTextHtml(value: RichText, ctx: Context): string {
  if (typeof value === 'string') return escapeHtml(value);
  return value
    .map((run) => {
      if (typeof run === 'string') return escapeHtml(run);
      if (run.t === 'text') return textRun(run, ctx);
      if (run.t === 'math') return mathHtml(run.tex, run.display === true, ctx);
      return '<br>';
    })
    .join('');
}

const text = (value: RichText, ctx: Context) => `<div class="qp-text">${richTextHtml(value, ctx)}</div>`;
const inlineText = (value: RichText, ctx: Context) => richTextHtml(value, ctx);

function widthStyle(widthPct: number | undefined): string {
  if (widthPct === undefined) return '';
  if (!Number.isInteger(widthPct) || widthPct < 20 || widthPct > 100) throw new Error('Invalid figure width.');
  return ` style="width:${widthPct}%"`;
}

function captionHtml(caption: RichText | undefined, ctx: Context): string {
  return caption === undefined ? '' : `<figcaption>${inlineText(caption, ctx)}</figcaption>`;
}

function blockHtml(block: Block, ctx: Context): string {
  if (block.type === 'paragraph') return `<p class="qp-paragraph">${inlineText(block.text, ctx)}</p>`;
  if (block.type === 'figure_placeholder') {
    ctx.state.figureCount += 1;
    return `<figure class="qp-figure qp-figure-placeholder"${widthStyle(block.widthPct)}><div>${FIGURE_PLACEHOLDER_LABEL}</div><div>${escapeHtml(block.description)}</div>${captionHtml(block.caption, ctx)}</figure>`;
  }
  if (block.type === 'figure') {
    const asset = ctx.figures.get(block.imageId);
    if (!asset) throw rpcError.badRequest(`The figure ${block.imageId} does not belong to this paper.`);
    ctx.state.figureCount += 1;
    // The data URI is built by the caller from a stored image; it never contains a quote.
    return `<figure class="qp-figure"${widthStyle(block.widthPct)}><img src="${asset.dataUri}" alt="${escapeHtml(block.alt)}">${captionHtml(block.caption, ctx)}</figure>`;
  }
  const [first, ...rest] = block.rows;
  const cell = (tag: 'th' | 'td', value: RichText) => `<${tag}>${inlineText(value, ctx)}</${tag}>`;
  const row = (cells: RichText[], tag: 'th' | 'td') => `<tr>${cells.map((value) => cell(tag, value)).join('')}</tr>`;
  const head = block.header && first ? `<thead>${row(first, 'th')}</thead>` : '';
  const bodyRows = block.header ? rest : block.rows;
  const caption = block.caption === undefined ? '' : `<caption>${inlineText(block.caption, ctx)}</caption>`;
  return `<table class="qp-table">${caption}${head}<tbody>${bodyRows.map((cells) => row(cells, 'td')).join('')}</tbody></table>`;
}

const blocksHtml = (blocks: Block[] | undefined, ctx: Context) => (blocks ?? []).map((block) => blockHtml(block, ctx)).join('');

function optionsHtml(options: QuestionPaperOption[] | undefined, ctx: Context): string {
  if (!options) return '';
  const items = options.map(
    (option) =>
      `<li class="qp-option"><span class="qp-option-label">${escapeHtml(option.label)}</span><div class="qp-option-body">${richTextHtml(option.text, ctx)}${(option.blocks ?? []).map((block) => blockHtml(block, ctx)).join('')}</div></li>`,
  );
  return `<ol class="qp-options">${items.join('')}</ol>`;
}

const marksHtml = (marks: number | null | undefined) =>
  marks === null || marks === undefined ? '' : `<span class="qp-marks">[${formatMarks(marks)}]</span>`;

type Content = {
  text: RichText;
  blocks?: Block[] | undefined;
  options?: QuestionPaperOption[] | undefined;
  parts?: Array<Content & { label: string; marks: number | null }> | undefined;
};

/** The text, blocks, options and parts shared by a question, a part and an alternative. */
function contentHtml(node: Content, ctx: Context): string {
  return (
    text(node.text, ctx) +
    blocksHtml(node.blocks, ctx) +
    optionsHtml(node.options, ctx) +
    (node.parts ?? [])
      .map(
        (part) =>
          `<div class="qp-part"><span class="qp-number">${escapeHtml(part.label)}</span><div class="qp-content">${contentHtml(part, ctx)}</div>${marksHtml(part.marks)}</div>`,
      )
      .join('')
  );
}

/** A short question stays on one page; a long one (parts, alternatives, many options) may break. */
const isShort = (question: { parts?: unknown[] | undefined; alternatives?: unknown[] | undefined; options?: unknown[] | undefined }) =>
  !question.parts && !question.alternatives && (question.options?.length ?? 0) <= 4;

type SectionQuestion = QuestionPaper['sections'][number]['questions'][number];

function questionHtml(question: SectionQuestion, ctx: Context): string {
  const alternatives = (question.alternatives ?? [])
    .map(
      (alternative) =>
        `<div class="qp-or">${OR_LABEL[ctx.base.language]}</div><div class="qp-alternative"><div class="qp-content">${contentHtml(alternative, ctx)}</div>${marksHtml(alternative.marks)}</div>`,
    )
    .join('');
  return `<div class="qp-question${isShort(question) ? ' qp-keep' : ''}"><span class="qp-number">${escapeHtml(question.number)}</span><div class="qp-content">${contentHtml(question, ctx)}${alternatives}</div>${marksHtml(question.marks)}</div>`;
}

function instructionsHtml(items: RichText[] | undefined, ctx: Context): string {
  if (!items || items.length === 0) return '';
  return `<ul class="qp-instructions">${items.map((item) => `<li>${inlineText(item, ctx)}</li>`).join('')}</ul>`;
}

function sectionHtml(section: QuestionPaper['sections'][number], ctx: Context): string {
  return (
    '<section class="qp-section">' +
    (section.heading === undefined ? '' : `<h2 class="qp-section-heading">${inlineText(section.heading, ctx)}</h2>`) +
    instructionsHtml(section.instructions, ctx) +
    blocksHtml(section.blocks, ctx) +
    section.questions.map((question) => questionHtml(question, ctx)).join('') +
    '</section>'
  );
}

/** The scoped stylesheet of the body. Constants only; no document value reaches it. */
function bodyCss(): string {
  const scripts = (Object.keys(SCRIPT_FONTS) as Script[])
    .map((script) => `.qp-body .qp-script-${script}{font-family:${SCRIPT_FONTS[script]}}`)
    .join('');
  return (
    '.qp-body{font-size:11pt;line-height:1.45;overflow-wrap:anywhere}' +
    scripts +
    '.qp-body .qp-title{font-size:14pt;text-align:center;margin:0 0 4mm}' +
    '.qp-body .qp-instructions{margin:0 0 3mm;padding-inline-start:6mm;list-style:disc}' +
    '.qp-body .qp-section{margin:0 0 4mm}' +
    '.qp-body .qp-section-heading{font-size:12pt;text-align:center;margin:4mm 0 2mm;break-after:avoid}' +
    '.qp-body .qp-question,.qp-body .qp-part{display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;column-gap:2.5mm;margin:0 0 2.5mm}' +
    '.qp-body .qp-part{margin:1.5mm 0 0}' +
    '.qp-body .qp-keep{break-inside:avoid}' +
    '.qp-body .qp-number{font-weight:600;min-width:6mm}' +
    '.qp-body .qp-marks{font-weight:600;white-space:nowrap}' +
    '.qp-body .qp-text{margin:0}' +
    '.qp-body .qp-options{list-style:none;margin:1mm 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1mm 6mm}' +
    '.qp-body .qp-option{display:flex;gap:2mm;break-inside:avoid}' +
    '.qp-body .qp-option-label{font-weight:600}' +
    '.qp-body .qp-or{text-align:center;font-weight:600;margin:2mm 0}' +
    '.qp-body .qp-alternative{display:grid;grid-template-columns:minmax(0,1fr) max-content;column-gap:2.5mm}' +
    '.qp-body .qp-paragraph{margin:1mm 0}' +
    '.qp-body .qp-table{border-collapse:collapse;margin:2mm 0;max-width:100%}' +
    '.qp-body .qp-table th,.qp-body .qp-table td{border:0.3mm solid #000;padding:1mm 2mm;vertical-align:top;text-align:start}' +
    '.qp-body .qp-table caption{caption-side:top;text-align:start;font-weight:600;padding-bottom:1mm}' +
    '.qp-body .qp-figure{margin:2mm auto;text-align:center;break-inside:avoid}' +
    '.qp-body .qp-figure img{max-width:100%;height:auto}' +
    '.qp-body .qp-figure figcaption{font-size:9.5pt}' +
    '.qp-body .qp-figure-placeholder{border:0.3mm dashed #555;padding:4mm;font-size:10pt;color:#333}' +
    '.qp-body .qp-math,.qp-body .qp-math-display{direction:ltr;unicode-bidi:isolate}' +
    '.qp-body .qp-math-display{margin:1mm 0;text-align:center;break-inside:avoid}' +
    '.qp-body .qp-math-display .katex-display{margin:0}' +
    '.qp-body .qp-math-error{font-family:monospace;color:#8a1c1c}'
  );
}

/**
 * Renders the structured paper to the HTML fragment that fills the template's
 * body slot. Pure: the same content, figures and KaTeX version always give
 * the same bytes. `figures` maps every `figure.imageId` the paper uses to its
 * data URI (see `loadFigureAssets`); a missing one is a BAD_REQUEST.
 */
export function renderQuestionPaperBodyHtml(
  content: QuestionPaper,
  input: { figures: FigureAssets; math: MathRenderer },
): RenderedBody {
  const { language, script, direction } = content.meta;
  lookup(SCRIPT_FONTS, script, 'script');
  const ctx: Context = {
    figures: input.figures,
    math: input.math,
    base: { language, script, direction },
    warnings: [],
    state: { hasMath: false, figureCount: 0 },
  };
  const lang = lookup(LANG_ATTRIBUTE, language, 'language');
  if (direction !== 'ltr' && direction !== 'rtl') throw new Error(`Unknown direction: ${direction}.`);

  const inner =
    (content.title === undefined ? '' : `<h1 class="qp-title">${inlineText(content.title, ctx)}</h1>`) +
    instructionsHtml(content.generalInstructions, ctx) +
    content.sections.map((section) => sectionHtml(section, ctx)).join('');

  const { hasMath } = ctx.state;
  const attributes = `class="qp-body qp-script-${script}"${lang ? ` lang="${lang}"` : ''} dir="${direction}"`;
  const html = `<style>${bodyCss()}${hasMath ? katexInlineCss() : ''}</style><div ${attributes}>${inner}</div>`;
  const byteSize = Buffer.byteLength(html, 'utf8');
  if (byteSize > QUESTION_PAPER_BODY_MAX_BYTES) {
    throw rpcError.badRequest('This paper is too large to print. Remove some figures or split it.');
  }
  return { html, hasMath, figureCount: ctx.state.figureCount, byteSize, warnings: ctx.warnings };
}

/** Every `figure.imageId` a paper uses, in document order, without repeats. */
export function paperFigureIds(content: QuestionPaper): string[] {
  const ids = new Set<string>();
  walkPaper(content, {
    block(block) {
      if (block.type === 'figure') ids.add(block.imageId);
    },
  });
  return [...ids];
}
