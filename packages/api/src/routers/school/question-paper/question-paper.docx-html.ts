import { defaultTreeAdapter as tree, parse, parseFragment } from 'parse5';

import { rpcError } from '../../../errors';
import { questionPaperBodyCss, type FigureAssets } from './question-paper.body';
import { QUESTION_PAPER_BODY_CLASS } from './question-paper.css';
import {
  attributeOf,
  bordersOf,
  Cascade,
  leadingSpacePx,
  lengthPx,
  textOf,
  valueTokens,
  type Element,
  type ElementStyle,
  type Node,
} from './question-paper.docx-css';
import { dataUriImage, imageSizeOf, type DocxImageType, type ImageSize } from './question-paper.docx-images';
import { sanitizeQuestionPaperBody } from './question-paper.sanitize';

/**
 * A saved question paper version as plain, Word-friendly HTML for Pandoc
 * (docs/question-papers.md "Word download"). Pure: the same fragment, figures
 * and rendered template always give the same output.
 *
 * TRUST BOUNDARY. The stored fragment is a model's output and UNTRUSTED. It is
 * sanitised AGAIN with the `question_paper_body` profile first, exactly as the
 * PDF renderer's step 1 does (`question-paper.body.ts`), and everything here
 * works on that output, never on the stored text. Nothing authored is passed
 * through: this file WRITES new markup from what it reads (text, a few facts
 * of the cascade, `lang`/`dir` checked against a pattern), escapes every string,
 * and names every image itself. Images are files of the conversion request
 * (`qp-image-N.png`), never URLs: only the paper's own stored figures (loaded by
 * `loadFigureAssets`), data URI images of the school's rendered template and the
 * paper's inline SVG (rasterised by the caller from the SVG this file
 * serialises) reach Pandoc. A literal `\(`, `\)`, `\[` or `\]` in text can never
 * open a formula: every backslash of text is written in a span of its own,
 * because Pandoc reads `\( … \)` only within one text run
 * (`html+tex_math_single_backslash`).
 *
 * What it maps, because Pandoc ignores CSS:
 * - flex rows and grids become borderless layout tables with column widths
 *   (the last column of a `space-between` row right-aligned: marks);
 * - a fully bordered block becomes a one-cell bordered table, an empty box with
 *   only a bottom border a run of underscores (a blank to write on), a block
 *   with only a top or bottom border a horizontal rule above or below it;
 * - bold, italic, underline, strike, superscript and subscript become tags;
 *   alignment and indentation become named paragraph styles
 *   ({@link DOCX_PARAGRAPH_STYLES}, defined by the reference document);
 * - `<span data-math>` becomes `\(LaTeX\)` / `\[LaTeX\]`, which Pandoc writes
 *   as a native Word equation (a bare operator at either end is moved out
 *   as text, {@link mathHtml});
 * - figures become images, placeholders a labelled bordered box, inline SVG
 *   an image the caller rasterises;
 * - `lang` and `dir` are kept; an inline element that holds blocks (a `<del>`
 *   around whole questions) is laid out as a block, as a browser does.
 *
 * Tables are recorded in document order, outer before inner
 * ({@link DocxTable}): Pandoc writes them in that order and the packaging step
 * (`question-paper.docx-package.ts`) gives each its borders and indent.
 *
 * The school's template is the rendered template document with the slot still
 * in place (the very HTML the PDF prints, `renderQuestionPaperTemplate`, or
 * the standalone shell's): everything before the slot is the heading, the
 * `position:fixed` elements become the Word footer on every page
 * ({@link DocxFooterLine}), and anything else after the slot follows the body.
 */

/** Text width of an A4 page with 15 mm margins, in CSS pixels (180 mm at 96 per inch); the reference document's page. */
export const DOCX_TEXT_WIDTH_PX = 680;
/** Nesting the converter follows; anything deeper is written as its text alone (a tree can be deeper than the call stack). */
const MAX_DEPTH = 120;
/** Elements a template may have; a rendered template is at most 2,000,000 characters, and a real one has a few hundred elements. */
const MAX_TEMPLATE_ELEMENTS = 20_000;
/** Footer lines kept, and characters of one footer part. */
const MAX_FOOTER_LINES = 4;
const MAX_FOOTER_PART_CHARS = 200;
/** The size an SVG with no size of its own takes in a browser, and the largest side one is rasterised at, in CSS pixels. */
const SVG_DEFAULT_SIZE: ImageSize = { width: 300, height: 150 };
const SVG_MAX_SIDE = 2_000;
/** One indent level of the paragraph styles, in CSS pixels (6 mm). */
const INDENT_STEP_PX = 22.7;

export type DocxTableKind =
  /** A flex row or grid, or an authored table without lines: no borders, tight cell margins. */
  | 'layout'
  /** A bordered block or a figure placeholder: one cell with a thin line round it. */
  | 'box'
  /** An authored table with lines. */
  | 'data';

/**
 * One table of the converted document, in the order Pandoc writes them (outer
 * before inner). `ruleAbove`/`ruleBelow`: a layout row that draws a line along
 * its top or bottom edge (a heading's ruled marks line) keeps that line as the
 * table's own top or bottom border.
 */
export type DocxTable = { kind: DocxTableKind; indent: number; rtl: boolean; ruleAbove: boolean; ruleBelow: boolean };

/** An image file of the conversion request, referenced from the HTML by `name`. `type` is what the bytes are now; a WebP must be converted to PNG by the caller (`name` already ends in `.png`). */
export type DocxImageFile = { name: string; type: DocxImageType; bytes: Buffer };

/** An inline SVG to rasterise to PNG `name` at `width` x `height` CSS pixels (its own size; Word shows it at the size the HTML gives). */
export type DocxSvg = { name: string; svg: string; width: number; height: number };

/** One line of the Word footer: its parts laid out left, centre and right (two parts: left and right). */
export type DocxFooterLine = { parts: string[]; align: 'left' | 'center' | 'right'; rtl: boolean; borderTop: boolean };

export type QuestionPaperDocxHtml = {
  html: string;
  tables: DocxTable[];
  images: DocxImageFile[];
  svgs: DocxSvg[];
  footer: DocxFooterLine[];
};

type Align = 'center' | 'right';

/** Paragraph style names the HTML uses (`custom-style`), each defined by the reference document. */
export const DOCX_PARAGRAPH_STYLES = {
  center: 'QP Center',
  right: 'QP Right',
  indent: (level: 1 | 2 | 3) => `QP Indent ${level}`,
  heading: (level: number, align: Align | null) => `QP Heading ${level}${align === 'center' ? ' Center' : align === 'right' ? ' Right' : ''}`,
} as const;

type Ctx = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: Align | null;
  indent: number;
  rtl: boolean;
  /** The width this content has, in CSS pixels (what 100% means). */
  width: number;
};

const ROOT_CTX: Ctx = { bold: false, italic: false, underline: false, strike: false, align: null, indent: 0, rtl: false, width: DOCX_TEXT_WIDTH_PX };

type Run = { html: string; content: boolean };
const EMPTY_RUN: Run = { html: '', content: false };
const joinRuns = (runs: Run[]): Run => ({ html: runs.map((run) => run.html).join(''), content: runs.some((run) => run.content) });

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'colgroup', 'col', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const NEVER_SHOWN = new Set(['head', 'style', 'script', 'title', 'template', 'meta', 'link', 'noscript']);
const HEADING_LEVEL: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const LANG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text as HTML in which no backslash can start a formula: each one in a span of its own (see the trust note above). */
const textHtml = (text: string) => escapeHtml(text).split('\\').join('<span>\\</span>');
const collapse = (text: string) => text.replace(/[\t\n\f\r ]+/g, ' ');
const isBlankText = (text: string) => /^[\t\n\f\r  ]*$/.test(text);

/** A size attribute (`width="200"`): a bare number is CSS pixels, anything else reads as a CSS length. */
const attributePx = (value: string | undefined): number | null => (value !== undefined && /^\d{1,5}(?:\.\d{1,4})?$/.test(value.trim()) ? Number(value) : lengthPx(value));

const childrenOf = (node: Node): Node[] => ('childNodes' in node ? (node.childNodes as Node[]) : []);
const isElement = (node: Node): node is Element => tree.isElementNode(node);
const elementChildren = (node: Node) => childrenOf(node).filter(isElement);

/** Every element under `root` (itself included) in document order, without recursion. */
function elementsOf(root: Node): Element[] {
  const out: Element[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isElement(node)) out.push(node);
    const children = node.nodeName === 'template' ? [] : childrenOf(node);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!);
  }
  return out;
}

/** Whether an element holds a picture or a formula (an empty box that does is not a blank). */
function holdsPicture(element: Element): boolean {
  return elementsOf(element).some((node) => node !== element && (node.tagName === 'img' || node.tagName === 'svg' || attributeOf(node, 'data-math') !== undefined));
}

/**
 * Bare operators a formula may start or end with before or after a blank
 * (`325+0=` then `____`). The equation such an operator ends is valid OMML,
 * but an editor whose equations need operands on both sides (LibreOffice
 * Math) shows a placeholder for the missing one, so the operator is written
 * as text beside the equation instead. Longest first.
 */
const TRAILING_OPERATORS: ReadonlyArray<readonly [string, string]> = [
  ['\\approx', '≈'], ['\\times', '×'], ['\\cdot', '·'], ['\\leq', '≤'], ['\\geq', '≥'], ['\\neq', '≠'], ['\\div', '÷'], ['\\pm', '±'],
  ['\\le', '≤'], ['\\ge', '≥'], ['\\ne', '≠'], ['\\lt', '<'], ['\\gt', '>'], ['=', '='], ['+', '+'], ['-', '−'], ['<', '<'], ['>', '>'],
];
/** At the start only relations and products: a leading `+` or `-` is a sign and has its operand. */
const LEADING_OPERATORS = TRAILING_OPERATORS.filter(([token]) => !['+', '-', '\\pm'].includes(token));

/** A formula as HTML Pandoc reads as an equation: `\(LaTeX\)`, or `\[LaTeX\]` for a displayed one. */
export function mathHtml(latex: string, display: boolean): Run {
  let body = latex.trim();
  // A formula that holds a delimiter itself, or ends in a backslash, could close the equation early: it is shown as
  // text (KaTeX refuses all of these, so a saved paper never has one; this only keeps the output well formed).
  if (body === '' || /\\[()[\]]/.test(body) || /\\$/.test(body)) return { html: textHtml(latex), content: latex.trim() !== '' };
  let before = '';
  let after = '';
  for (const [token, text] of TRAILING_OPERATORS) {
    if (body.length > token.length && body.endsWith(token) && body[body.length - token.length - 1] !== '\\') {
      body = body.slice(0, -token.length).trimEnd();
      after = text;
      break;
    }
  }
  for (const [token, text] of LEADING_OPERATORS) {
    const rest = body.slice(token.length);
    // `\le` must not take the start of `\left`: a command token is followed by a non-letter.
    if (body.length > token.length && body.startsWith(token) && !(token.startsWith('\\') && /^[A-Za-z]/.test(rest))) {
      body = rest.trimStart();
      before = text;
      break;
    }
  }
  const open = display ? '\\[' : '\\(';
  const close = display ? '\\]' : '\\)';
  return { html: `${textHtml(before)}${open}${escapeHtml(body)}${close}${textHtml(after)}`, content: true };
}

/** Converts parsed trees under one cascade; collects tables, images and SVGs for the whole document. */
class Converter {
  private depth = 0;
  private readonly blockCache = new Map<Element, boolean>();
  private cascade: Cascade = new Cascade([]);
  readonly tables: DocxTable[] = [];
  readonly svgs: DocxSvg[] = [];
  private readonly images = new Map<string, DocxImageFile>();
  /** `position:fixed` elements found while converting the template (they become the footer, not text). */
  readonly fixed: Array<{ element: Element; ctx: Ctx }> = [];

  constructor(private readonly figures: FigureAssets) {}

  imageFiles(): DocxImageFile[] {
    return [...this.images.values()];
  }

  use(cascade: Cascade) {
    this.cascade = cascade;
    this.blockCache.clear();
  }

  style(element: Element): ElementStyle {
    return this.cascade.of(element);
  }

  display(element: Element): string {
    const declared = this.style(element).get('display')?.toLowerCase().trim();
    if (declared) {
      const tokens = declared.split(/\s+/);
      // The two-value syntax (`inline flex`) is the one-value `inline-flex`.
      if (tokens.length === 2 && tokens[0] === 'inline' && ['flex', 'grid'].includes(tokens[1]!)) return `inline-${tokens[1]}`;
      if (tokens.length === 2 && tokens[0] === 'block') return tokens[1]!;
      return tokens[0]!;
    }
    if (NEVER_SHOWN.has(element.tagName)) return 'none';
    return BLOCK_TAGS.has(element.tagName) ? 'block' : 'inline';
  }

  hidden(element: Element): boolean {
    if (NEVER_SHOWN.has(element.tagName)) return true;
    const style = this.style(element);
    return this.display(element) === 'none' || ['hidden', 'collapse'].includes(style.get('visibility')?.toLowerCase() ?? '');
  }

  isFixed(element: Element): boolean {
    return this.style(element).get('position')?.toLowerCase().trim() === 'fixed';
  }

  /** A flex row or a grid: laid out side by side, so it becomes a table. A flex column is ordinary blocks. */
  isLayout(element: Element): boolean {
    const display = this.display(element);
    if (display === 'grid' || display === 'inline-grid') return true;
    if (display !== 'flex' && display !== 'inline-flex') return false;
    const direction = this.style(element).get('flex-direction') ?? this.style(element).get('flex-flow') ?? '';
    return !/column/.test(direction);
  }

  fullBorder(element: Element): boolean {
    const sides = bordersOf(this.style(element));
    return sides.top && sides.right && sides.bottom && sides.left;
  }

  /** Whether this element is laid out as a block (see the file note: an inline element holding blocks is one too). */
  isBlockish(node: Node): node is Element {
    if (!isElement(node) || this.hidden(node)) return false;
    const cached = this.blockCache.get(node);
    if (cached !== undefined) return cached;
    // Children first, iteratively, so a deep tree never recurses here; known elements and drawings are not entered.
    const order: Element[] = [];
    const stack: Element[] = [node];
    while (stack.length > 0) {
      const element = stack.pop()!;
      order.push(element);
      if (element.tagName === 'svg') continue;
      for (const child of elementChildren(element)) if (!this.blockCache.has(child)) stack.push(child);
    }
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const element = order[index]!;
      if (this.blockCache.has(element)) continue;
      this.blockCache.set(element, this.selfBlock(element) || (element.tagName !== 'svg' && elementChildren(element).some((child) => !this.hidden(child) && this.blockCache.get(child) === true)));
    }
    return this.blockCache.get(node) ?? false;
  }

  private selfBlock(element: Element): boolean {
    if (this.hidden(element) || element.tagName === 'svg' || element.tagName === 'img') return false;
    const display = this.display(element);
    if (this.isLayout(element)) return true;
    if (display === 'inline-block') return this.fullBorder(element) && !isBlankText(textOf(element));
    return display !== 'inline' && display !== 'contents' && display !== 'inline-flex' && display !== 'inline-grid';
  }

  childCtx(element: Element, ctx: Ctx): Ctx {
    const style = this.style(element);
    const tag = element.tagName;
    const weight = style.get('font-weight')?.toLowerCase();
    const fontStyle = style.get('font-style')?.toLowerCase();
    const decoration = `${style.get('text-decoration') ?? ''} ${style.get('text-decoration-line') ?? ''}`.toLowerCase();
    const textAlign = style.get('text-align')?.toLowerCase().trim();
    const dir = attributeOf(element, 'dir')?.toLowerCase() ?? style.get('direction')?.toLowerCase().trim();
    const rtl = dir === 'rtl' ? true : dir === 'ltr' ? false : ctx.rtl;
    let align = ctx.align;
    if (tag === 'center' || textAlign === 'center') align = 'center';
    else if ((textAlign === 'right' || textAlign === 'end') && !rtl) align = 'right';
    else if (textAlign !== undefined && ['left', 'start', 'justify', 'right', 'end'].includes(textAlign)) align = null;
    const lists = tag === 'ul' || tag === 'ol';
    const indentPx = lists ? 0 : leadingSpacePx(style, 'margin', ctx.width) + leadingSpacePx(style, 'padding', ctx.width);
    const indent = Math.min(3, ctx.indent + (indentPx >= 8 || tag === 'blockquote' || tag === 'dd' ? 1 : 0));
    const ownWidth = lengthPx(style.get('width'), ctx.width);
    return {
      bold: weight ? /bold|bolder|^[6-9]00$/.test(weight) || (!/normal|lighter|^[1-5]00$/.test(weight) && ctx.bold) : ctx.bold || ['b', 'strong', 'th', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag),
      italic: fontStyle ? /italic|oblique/.test(fontStyle) : ctx.italic || ['i', 'em', 'cite', 'var', 'dfn'].includes(tag),
      underline: ctx.underline || tag === 'u' || tag === 'ins' || decoration.includes('underline'),
      strike: ctx.strike || tag === 's' || tag === 'del' || tag === 'strike' || decoration.includes('line-through'),
      align,
      indent,
      rtl,
      width: Math.max(40, Math.min(ctx.width, ownWidth ?? ctx.width) - (indent - ctx.indent) * INDENT_STEP_PX),
    };
  }

  // ---- inline content

  inline(node: Node, ctx: Ctx): Run {
    if (tree.isTextNode(node)) {
      const text = collapse(node.value);
      if (text === '') return EMPTY_RUN;
      return { html: this.formatted(textHtml(text), ctx), content: !isBlankText(text) };
    }
    if (!isElement(node) || this.hidden(node) || (this.isFixed(node) && this.collectFixed(node, ctx))) return EMPTY_RUN;
    const tag = node.tagName;
    if (tag === 'br') return { html: '<br>', content: false };
    const math = attributeOf(node, 'data-math');
    if (math !== undefined) return mathHtml(math, attributeOf(node, 'data-display') === 'true');
    if (tag === 'svg') return this.svgImage(node, ctx);
    if (tag === 'img') return this.image(node, ctx);
    if (this.depth > MAX_DEPTH) return { html: this.formatted(textHtml(collapse(textOf(node))), ctx), content: !isBlankText(textOf(node)) };
    const blank = this.blank(node, ctx, 70);
    if (blank) return blank;
    const inner = this.childCtx(node, ctx);
    this.depth += 1;
    let run = joinRuns(childrenOf(node).map((child) => this.inline(child, inner)));
    this.depth -= 1;
    const style = this.style(node);
    const vertical = style.get('vertical-align')?.toLowerCase();
    if (run.content && (tag === 'sup' || vertical === 'super')) run = { ...run, html: `<sup>${run.html}</sup>` };
    else if (run.content && (tag === 'sub' || vertical === 'sub')) run = { ...run, html: `<sub>${run.html}</sub>` };
    return { ...run, html: this.langSpan(node, run.html) };
  }

  private formatted(html: string, ctx: Ctx): string {
    let out = html;
    if (ctx.italic) out = `<em>${out}</em>`;
    if (ctx.bold) out = `<strong>${out}</strong>`;
    if (ctx.underline) out = `<u>${out}</u>`;
    if (ctx.strike) out = `<s>${out}</s>`;
    return out;
  }

  private langAttributes(element: Element): string {
    const lang = attributeOf(element, 'lang');
    const dir = attributeOf(element, 'dir')?.toLowerCase() ?? this.style(element).get('direction')?.toLowerCase().trim();
    return `${lang !== undefined && LANG.test(lang) ? ` lang="${escapeHtml(lang)}"` : ''}${dir === 'rtl' || dir === 'ltr' ? ` dir="${dir}"` : ''}`;
  }

  private langSpan(element: Element, html: string): string {
    const attributes = this.langAttributes(element);
    return attributes && html !== '' ? `<span${attributes}>${html}</span>` : html;
  }

  private langDiv(element: Element, html: string): string {
    const attributes = this.langAttributes(element);
    return attributes && html !== '' ? `<div${attributes}>${html}</div>` : html;
  }

  /**
   * An empty element that is a place to write: only a bottom line becomes
   * underscores as wide as the element (`maxUnderscores` at most); a box with
   * lines all round becomes an empty bracketed space. Null for anything else.
   */
  private blank(element: Element, ctx: Ctx, maxUnderscores: number): Run | null {
    if (!isBlankText(textOf(element)) || holdsPicture(element)) return null;
    const sides = bordersOf(this.style(element));
    const style = this.style(element);
    const width = lengthPx(style.get('width'), ctx.width) ?? lengthPx(style.get('min-width'), ctx.width) ?? (this.display(element) === 'block' ? ctx.width : 120);
    if (sides.bottom && !sides.top && !sides.left && !sides.right) {
      return { html: '_'.repeat(Math.max(6, Math.min(maxUnderscores, Math.round(width / 7)))), content: true };
    }
    if (sides.top && sides.right && sides.bottom && sides.left && this.display(element) !== 'block') return { html: '[    ]', content: true };
    return null;
  }

  /** Registers an image file once per source (a logo used three times is one file) and returns its name. */
  private registerImage(key: string, type: DocxImageType, bytes: Buffer): string {
    const known = this.images.get(key);
    if (known) return known.name;
    const name = `qp-image-${this.images.size + 1}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
    this.images.set(key, { name, type, bytes });
    return name;
  }

  /** The size an image shows at: its CSS width and height (fitted inside both when both are set), else its own pixels, never wider than the space it has. */
  private shownSize(element: Element, natural: ImageSize, ctx: Ctx): ImageSize {
    const style = this.style(element);
    const ratio = natural.width / natural.height;
    const width = lengthPx(style.get('width'), ctx.width) ?? attributePx(attributeOf(element, 'width'));
    const height = lengthPx(style.get('height')) ?? attributePx(attributeOf(element, 'height'));
    let size: ImageSize;
    if (width && height) size = width / height > ratio ? { width: height * ratio, height } : { width, height: width / ratio };
    else if (width) size = { width, height: width / ratio };
    else if (height) size = { width: height * ratio, height };
    else size = natural;
    const max = Math.min(ctx.width, lengthPx(style.get('max-width'), ctx.width) ?? ctx.width);
    if (size.width > max) size = { width: max, height: max / ratio };
    return { width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
  }

  private imageTag(name: string, size: ImageSize, alt: string): string {
    return `<img src="${name}" alt="${escapeHtml(alt)}" width="${size.width}" height="${size.height}">`;
  }

  /** A figure of the paper (`data-figure-id`, only this paper's own images, loaded by the caller) or a data URI image of the template. */
  private image(element: Element, ctx: Ctx): Run {
    const figureId = attributeOf(element, 'data-figure-id');
    const source = figureId !== undefined ? this.figures.get(figureId)?.dataUri : attributeOf(element, 'src');
    const decoded = source === undefined ? null : dataUriImage(source);
    const natural = decoded ? imageSizeOf(decoded.bytes) : null;
    if (!decoded || !natural) {
      return figureId !== undefined ? { html: '<em>Figure unavailable</em>', content: true } : EMPTY_RUN;
    }
    const name = this.registerImage(figureId !== undefined ? `figure:${figureId}` : `src:${source}`, decoded.type, decoded.bytes);
    return { html: this.imageTag(name, this.shownSize(element, natural, ctx), figureId !== undefined ? 'Figure' : 'Image'), content: true };
  }

  /** An inline SVG: serialised on its own (styles the cascade gives it written inline) for the caller to rasterise. */
  private svgImage(element: Element, ctx: Ctx): Run {
    const style = this.style(element);
    const viewBox = (attributeOf(element, 'viewbox') ?? attributeOf(element, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const boxRatio = viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0 ? viewBox[2]! / viewBox[3]! : null;
    let width = attributePx(attributeOf(element, 'width')) ?? lengthPx(style.get('width'), ctx.width);
    let height = attributePx(attributeOf(element, 'height')) ?? lengthPx(style.get('height'));
    if (width && !height) height = boxRatio ? width / boxRatio : SVG_DEFAULT_SIZE.height;
    if (height && !width) width = boxRatio ? height * boxRatio : SVG_DEFAULT_SIZE.width;
    if (!width || !height) ({ width, height } = boxRatio ? { width: SVG_DEFAULT_SIZE.width, height: SVG_DEFAULT_SIZE.width / boxRatio } : SVG_DEFAULT_SIZE);
    const raster = { width: Math.max(1, Math.min(SVG_MAX_SIDE, Math.round(width))), height: Math.max(1, Math.min(SVG_MAX_SIDE, Math.round(height))) };
    const name = `qp-svg-${this.svgs.length + 1}.png`;
    this.svgs.push({ name, svg: serializeSvg(element, raster, (node) => this.style(node), inheritedSvgStyle(element, (node) => this.style(node))), ...raster });
    return { html: this.imageTag(name, this.shownSize(element, raster, ctx), 'Diagram'), content: true };
  }

  // ---- blocks

  /** The children of an element as blocks: inline runs become paragraphs, block children are converted on their own. */
  blocks(parent: Node, ctx: Ctx, from = 0, to = Number.POSITIVE_INFINITY): string {
    const out: string[] = [];
    let run: Run[] = [];
    const flush = () => {
      out.push(this.paragraph(joinRuns(run), ctx));
      run = [];
    };
    const children = childrenOf(parent);
    for (let index = from; index < Math.min(children.length, to); index += 1) {
      const child = children[index]!;
      if (this.isBlockish(child)) {
        flush();
        out.push(this.block(child, ctx));
      } else run.push(this.inline(child, ctx));
    }
    flush();
    return out.join('');
  }

  paragraph(run: Run, ctx: Ctx, headingLevel: number | null = null): string {
    if (!run.content) return '';
    const name =
      headingLevel !== null
        ? DOCX_PARAGRAPH_STYLES.heading(headingLevel, ctx.align)
        : ctx.align === 'center'
          ? DOCX_PARAGRAPH_STYLES.center
          : ctx.align === 'right'
            ? DOCX_PARAGRAPH_STYLES.right
            : ctx.indent > 0
              ? DOCX_PARAGRAPH_STYLES.indent(Math.min(3, ctx.indent) as 1 | 2 | 3)
              : null;
    return name ? `<div custom-style="${name}"><p>${run.html}</p></div>` : `<p>${run.html}</p>`;
  }

  /** A `position:fixed` element of the template: kept for the footer and never written as text. Always true (so `inline` can skip it in one expression). */
  private collectFixed(element: Element, ctx: Ctx): true {
    this.fixed.push({ element, ctx });
    return true;
  }

  block(element: Element, ctx: Ctx): string {
    if (this.isFixed(element)) {
      this.collectFixed(element, ctx);
      return '';
    }
    if (this.depth > MAX_DEPTH) {
      const text = collapse(textOf(element));
      return this.paragraph({ html: this.formatted(textHtml(text), ctx), content: !isBlankText(text) }, ctx);
    }
    this.depth += 1;
    try {
      return this.langDiv(element, this.blockContent(element, ctx));
    } finally {
      this.depth -= 1;
    }
  }

  private blockContent(element: Element, ctx: Ctx): string {
    const tag = element.tagName;
    const inner = this.childCtx(element, ctx);
    if (tag === 'hr') return '<hr>';
    if (tag === 'figure' && attributeOf(element, 'data-placeholder') !== undefined && attributeOf(element, 'data-figure-id') === undefined) {
      return this.placeholderBox(attributeOf(element, 'data-placeholder')!, inner);
    }
    if (tag === 'table') return this.dataTable(element, inner);
    if (tag === 'ul' || tag === 'ol') return this.list(element, inner);
    const blank = this.blank(element, ctx, 95);
    if (blank) return this.paragraph(blank, inner);
    const sides = bordersOf(this.style(element));
    if (this.isLayout(element)) return this.layoutTable(element, inner, { above: sides.top, below: sides.bottom });
    if (this.fullBorder(element)) return this.box(element, inner);
    const html = this.flowContent(element, inner);
    // A line above or below a block (a heading's rule) is a horizontal rule; lines at its sides alone carry no meaning in Word.
    return `${html !== '' && sides.top ? '<hr>' : ''}${html}${html !== '' && sides.bottom ? '<hr>' : ''}`;
  }

  /** A block in normal flow: a heading paragraph, or its children as blocks (a figure's image first). */
  private flowContent(element: Element, inner: Ctx): string {
    const level = HEADING_LEVEL[element.tagName];
    const hasBlocks = childrenOf(element).some((child) => this.isBlockish(child));
    if (level !== undefined && !hasBlocks) return this.paragraph(joinRuns(childrenOf(element).map((child) => this.inline(child, inner))), inner, level);
    let html = '';
    if (element.tagName === 'figure' && attributeOf(element, 'data-figure-id') !== undefined && !elementsOf(element).some((node) => node.tagName === 'img')) {
      html += this.paragraph(this.image(element, inner), inner);
    }
    return html + this.blocks(element, inner);
  }

  /** Records a table before its content is converted, so the list stays in Pandoc's order (outer before inner). */
  private recordTable(kind: DocxTableKind, ctx: Ctx, rules: { above: boolean; below: boolean } = { above: false, below: false }) {
    this.tables.push({ kind, indent: ctx.indent, rtl: ctx.rtl, ruleAbove: rules.above, ruleBelow: rules.below });
  }

  private oneCell(html: string): string {
    return `<table><colgroup><col width="100%"></colgroup><tbody><tr><td>${html}</td></tr></tbody></table>`;
  }

  private box(element: Element, ctx: Ctx): string {
    this.recordTable('box', ctx);
    return this.oneCell(this.blocks(element, { ...ctx, indent: 0, width: ctx.width - 10 }));
  }

  /** A figure still to be added: a labelled box, like the PDF's dashed one ("Figure to be added" and the description). */
  private placeholderBox(description: string, ctx: Ctx): string {
    this.recordTable('box', ctx);
    const cell = { ...ctx, indent: 0, align: 'center' as const };
    const label = description.trim() === '' ? 'Figure' : collapse(description).trim();
    return this.oneCell(
      this.paragraph({ html: '<em>Figure to be added</em>', content: true }, cell) + this.paragraph({ html: textHtml(label), content: true }, cell),
    );
  }

  private list(element: Element, ctx: Ctx): string {
    const style = this.style(element);
    const listStyle = `${style.get('list-style') ?? ''} ${style.get('list-style-type') ?? ''}`.toLowerCase();
    const items = childrenOf(element).filter((child) => isElement(child) && !this.hidden(child)) as Element[];
    const itemCtx = { ...ctx, indent: 0, width: ctx.width - INDENT_STEP_PX };
    if (/\bnone\b/.test(listStyle)) return items.map((item) => this.block(item, ctx)).join('');
    const body = items
      .map((item) => {
        const inner = this.childCtx(item, itemCtx);
        const hasBlocks = childrenOf(item).some((child) => this.isBlockish(child));
        // A plain item is written without a paragraph, so Pandoc keeps the list tight (Compact).
        const html = hasBlocks ? this.blocks(item, inner) : joinRuns(childrenOf(item).map((child) => this.inline(child, inner))).html;
        return `<li>${this.langDiv(item, html)}</li>`;
      })
      .join('');
    if (element.tagName === 'ul') return `<ul>${body}</ul>`;
    const start = Number(attributeOf(element, 'start'));
    const type = /lower-(alpha|latin)/.test(listStyle) ? 'a' : /upper-(alpha|latin)/.test(listStyle) ? 'A' : /lower-roman/.test(listStyle) ? 'i' : /upper-roman/.test(listStyle) ? 'I' : null;
    return `<ol${Number.isInteger(start) && start >= 1 && start <= 10_000 ? ` start="${start}"` : ''}${type ? ` type="${type}"` : ''}>${body}</ol>`;
  }

  /** A flex row (one row) or a grid (row by row) as a borderless table with column widths. */
  private layoutTable(element: Element, ctx: Ctx, rules: { above: boolean; below: boolean } = { above: false, below: false }): string {
    const style = this.style(element);
    const items = childrenOf(element).filter((child) => (isElement(child) ? !this.hidden(child) && !this.isFixed(child) : tree.isTextNode(child) && !isBlankText(child.value)));
    if (items.length === 0) return '';
    const grid = /grid/.test(this.display(element));
    const { columns, widths, aligns } = grid ? this.gridColumns(style, items.length, ctx) : this.flexColumns(style, items, ctx);
    this.recordTable('layout', ctx, rules);
    const colgroup = widths.map((width) => `<col width="${width.toFixed(1)}%">`).join('');
    const rows: string[] = [];
    for (let start = 0; start < items.length; start += columns) {
      const cells: string[] = [];
      for (let column = 0; column < columns; column += 1) {
        const item = items[start + column];
        const align = aligns[column] ?? null;
        const cellCtx: Ctx = { ...ctx, indent: 0, align: align ?? ctx.align, width: (ctx.width * widths[column]!) / 100 };
        cells.push(`<td${align ? ` style="text-align:${align}"` : ''}>${item ? this.cell(item, cellCtx) : ''}</td>`);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<table><colgroup>${colgroup}</colgroup><tbody>${rows.join('')}</tbody></table>`;
  }

  private cell(item: Node, ctx: Ctx): string {
    if (this.isBlockish(item)) return this.block(item, ctx);
    if (isElement(item)) return this.langDiv(item, this.paragraph(this.inline(item, ctx), this.childCtx(item, ctx)));
    return this.paragraph(this.inline(item, ctx), ctx);
  }

  /** Grid tracks: `repeat(N, …)`, or one per track, `fr` shares and fixed lengths kept in proportion. */
  private gridColumns(style: ElementStyle, itemCount: number, ctx: Ctx) {
    const template = style.get('grid-template-columns')?.trim() ?? '';
    const repeat = /^repeat\(\s*(\d{1,2})\s*,(.*)\)$/i.exec(template);
    const tracks = repeat ? Array<string>(Math.min(12, Number(repeat[1]))).fill(repeat[2]!.trim()) : valueTokens(template).slice(0, 40);
    const columns = Math.max(1, Math.min(tracks.length || 1, itemCount));
    const fixed = tracks.slice(0, columns).map((track) => lengthPx(track, ctx.width));
    const fixedTotal = fixed.reduce<number>((sum, width) => sum + (width ?? 0), 0);
    const shares = tracks.slice(0, columns).map((track) => Number(/^(\d{1,3}(?:\.\d{1,3})?)fr$/.exec(track)?.[1] ?? 1));
    const shareTotal = shares.reduce((sum, share, index) => sum + (fixed[index] === null ? share : 0), 0) || 1;
    const freePercent = Math.max(10, 100 - (fixedTotal / ctx.width) * 100);
    const widths = normalise(fixed.map((width, index) => (width !== null ? (width / ctx.width) * 100 : (freePercent * shares[index]!) / shareTotal)));
    return { columns, widths, aligns: [] as Array<Align | null> };
  }

  /**
   * Flex items side by side. Each item is as wide as its text needs (within
   * limits) or its own width; items that grow share what is left; with
   * `space-between` the first item takes the rest and the last is aligned
   * right (the marks of a question). A wrapping row whose items do not fit
   * becomes equal columns, as many as the widest item allows.
   */
  private flexColumns(style: ElementStyle, items: Node[], ctx: Ctx) {
    const justify = style.get('justify-content')?.toLowerCase() ?? '';
    const textLength = (node: Node) =>
      collapse(isElement(node) ? textOf(node) : (node as { value: string }).value).trim().length +
      (isElement(node) ? elementsOf(node).filter((element) => attributeOf(element, 'data-math') !== undefined).length * 3 : 0);
    const own = items.map((node) => (isElement(node) ? (lengthPx(this.style(node).get('width'), ctx.width) ?? lengthPx(this.style(node).get('flex-basis'), ctx.width)) : null));
    const grows = items.map((node) => {
      if (!isElement(node)) return false;
      const itemStyle = this.style(node);
      const flex = itemStyle.get('flex')?.trim().toLowerCase() ?? '';
      return flex === 'auto' || /^[1-9]/.test(flex) || /^0?\.\d*[1-9]/.test(flex) || Number(itemStyle.get('flex-grow') ?? 0) > 0;
    });
    // The gap between items belongs to the item before it, so a fixed-width item (a logo) keeps its whole width.
    const gap = ((lengthPx(valueTokens(style.get('column-gap') ?? style.get('gap') ?? '').pop(), ctx.width) ?? 0) / ctx.width) * 100;
    const natural = items.map((node, index) => {
      const after = index < items.length - 1 ? gap : 0;
      if (own[index] !== null) return (own[index]! / ctx.width) * 100 + after + 1;
      const minimum = isElement(node) ? ((lengthPx(this.style(node).get('min-width'), ctx.width) ?? 0) / ctx.width) * 100 : 0;
      return Math.max(Math.min(45, Math.max(4, textLength(node) * 1.45 + 3)), minimum) + after;
    });
    const wraps = /wrap/.test(`${style.get('flex-wrap') ?? ''} ${style.get('flex-flow') ?? ''}`) && !/nowrap/.test(style.get('flex-wrap') ?? '');
    if (wraps && natural.reduce((sum, width) => sum + width, 0) > 100) {
      const columns = Math.max(1, Math.min(items.length, Math.floor(100 / Math.max(...natural))));
      return { columns, widths: Array<number>(columns).fill(100 / columns), aligns: [] as Array<Align | null> };
    }
    let widths: number[];
    if (grows.some(Boolean)) {
      const fixed = natural.reduce((sum, width, index) => sum + (grows[index] ? 0 : width), 0);
      const share = Math.max(20, 100 - fixed) / grows.filter(Boolean).length;
      widths = natural.map((width, index) => (grows[index] ? share : width));
    } else if (/space-between/.test(justify) && items.length > 1) {
      const rest = natural.slice(1).reduce((sum, width) => sum + width, 0);
      widths = [Math.max(20, 100 - rest), ...natural.slice(1)];
    } else widths = natural;
    const rightLast = items.length > 1 && /space-between|flex-end|end/.test(justify);
    return {
      columns: items.length,
      widths: normalise(widths, false),
      aligns: items.map((_, index) => (rightLast && index === items.length - 1 ? ('right' as const) : null)),
    };
  }

  /** An authored table: its rows and spans, bordered when the table or one of its cells draws a line. */
  private dataTable(element: Element, ctx: Ctx): string {
    const rows: Element[] = [];
    let caption: Element | null = null;
    for (const child of elementChildren(element)) {
      if (child.tagName === 'tr') rows.push(child);
      else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) rows.push(...elementChildren(child).filter((row) => row.tagName === 'tr'));
      else if (child.tagName === 'caption') caption = child;
    }
    const cellsOf = (row: Element) => elementChildren(row).filter((cell) => (cell.tagName === 'td' || cell.tagName === 'th') && !this.hidden(cell));
    const filled = rows.filter((row) => !this.hidden(row) && cellsOf(row).length > 0);
    if (filled.length === 0) return '';
    const lined = (node: Element) => {
      const sides = bordersOf(this.style(node));
      return sides.top || sides.bottom || sides.left || sides.right;
    };
    const bordered = lined(element) || filled.some((row) => cellsOf(row).some(lined));
    const captionHtml = caption ? this.paragraph(joinRuns(childrenOf(caption).map((child) => this.inline(child, { ...ctx, bold: true }))), ctx) : '';
    this.recordTable(bordered ? 'data' : 'layout', ctx);
    const columns = Math.max(...filled.map((row) => cellsOf(row).reduce((sum, cell) => sum + span(cell, 'colspan'), 0)));
    const body = filled
      .map((row) => {
        const cells = cellsOf(row).map((cell) => {
          const colspan = span(cell, 'colspan');
          const rowspan = span(cell, 'rowspan');
          const inner = this.childCtx(cell, { ...ctx, indent: 0, width: (ctx.width * colspan) / columns - 10 });
          const align = inner.align;
          return `<td${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}${align ? ` style="text-align:${align}"` : ''}>${this.blocks(cell, inner)}</td>`;
        });
        return `<tr>${cells.join('')}</tr>`;
      })
      .join('');
    return `${captionHtml}<table><tbody>${body}</tbody></table>`;
  }

  /** The Word footer lines of the template's `position:fixed` elements, in document order. */
  footer(): DocxFooterLine[] {
    const lines: DocxFooterLine[] = [];
    for (const { element, ctx } of this.fixed) {
      if (this.fixed.some((other) => other.element !== element && isAncestor(other.element, element))) continue;
      const style = this.style(element);
      const inner = this.childCtx(element, ctx);
      const textOfPart = (node: Node) => collapse(isElement(node) ? textOf(node) : (node as { value: string }).value).trim().slice(0, MAX_FOOTER_PART_CHARS);
      let parts: string[];
      if (this.isLayout(element)) {
        parts = childrenOf(element)
          .filter((child) => (isElement(child) ? !this.hidden(child) : tree.isTextNode(child) && !isBlankText(child.value)))
          .map(textOfPart);
        if (parts.length > 3) parts = [parts[0]!, parts.slice(1, -1).filter((part) => part !== '').join(' · '), parts.at(-1)!];
      } else parts = [textOfPart(element)];
      if (parts.every((part) => part === '')) continue;
      lines.push({ parts, align: inner.align === 'center' ? 'center' : inner.align === 'right' ? 'right' : 'left', rtl: inner.rtl, borderTop: bordersOf(style).top });
      if (lines.length >= MAX_FOOTER_LINES) break;
    }
    return lines;
  }
}

const span = (cell: Element, name: 'colspan' | 'rowspan') => {
  const value = Number(attributeOf(cell, name) ?? 1);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, 50) : 1;
};

/** Widths as percentages summing to 100 (or at most 100 when `fill` is false and they already fit). */
function normalise(widths: number[], fill = true): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return widths.map(() => 100 / widths.length);
  return fill || total > 100 ? widths.map((width) => (width * 100) / total) : widths;
}

const parentNodeOf = (node: Node): Node | null => ('parentNode' in node ? ((node.parentNode as Node | null) ?? null) : null);

function isAncestor(ancestor: Element, node: Node): boolean {
  for (let parent = parentNodeOf(node); parent; parent = parentNodeOf(parent)) {
    if (parent === ancestor) return true;
  }
  return false;
}

/** SVG presentation properties a rasterised diagram keeps from the cascade, and the only value characters allowed. */
const SVG_STYLE_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'display', 'visibility',
]);
const SVG_STYLE_VALUE = /^[#(),.%\-\w \t'"]{0,200}$/;
const SVG_ATTRIBUTE_NAME = /^[a-zA-Z][a-zA-Z0-9:-]{0,40}$/;
const INHERITED_SVG_PROPERTIES = ['color', 'font-family', 'font-size', 'font-weight', 'font-style'];

function svgStyleText(declarations: ReadonlyArray<{ property: string; value: string }>): string {
  return declarations
    .filter(({ property, value }) => SVG_STYLE_PROPERTIES.has(property) && SVG_STYLE_VALUE.test(value) && !/url|expression/i.test(value))
    .map(({ property, value }) => `${property}:${value}`)
    .join(';');
}

/** The text properties an SVG inherits from the paper around it (the nearest ancestor that sets each). */
function inheritedSvgStyle(element: Element, styleOf: (element: Element) => ElementStyle): Array<{ property: string; value: string }> {
  const found = new Map<string, string>();
  for (let node = element.parentNode as Node | null; node && isElement(node); node = node.parentNode as Node | null) {
    for (const property of INHERITED_SVG_PROPERTIES) {
      const value = styleOf(node).get(property);
      if (value !== undefined && !found.has(property)) found.set(property, value);
    }
  }
  return [...found].map(([property, value]) => ({ property, value }));
}

/**
 * A standalone SVG document for the rasteriser: the sanitised element's own
 * attributes (the profile's safe subset; `style` and `class` are replaced by
 * the declarations the cascade gave each element, filtered to presentation
 * properties) at its own size, every value escaped.
 */
function serializeSvg(root: Element, size: ImageSize, styleOf: (element: Element) => ElementStyle, inherited: Array<{ property: string; value: string }>): string {
  const write = (node: Node, top: boolean, depth: number): string => {
    if (tree.isTextNode(node)) return escapeHtml(node.value);
    if (!isElement(node) || depth > MAX_DEPTH) return '';
    const attributes = node.attrs
      .filter((attribute) => SVG_ATTRIBUTE_NAME.test(attribute.name))
      .filter((attribute) => !['style', 'class', 'width', 'height', 'xmlns'].includes(attribute.name) || (!top && ['width', 'height'].includes(attribute.name)))
      .map((attribute) => ` ${attribute.name}="${escapeHtml(attribute.value)}"`)
      .join('');
    const style = svgStyleText(top ? [...inherited, ...styleOf(node).ordered] : styleOf(node).ordered);
    const extra = top ? ` xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"` : '';
    return `<${node.tagName}${extra}${attributes}${style ? ` style="${escapeHtml(style)}"` : ''}>${childrenOf(node).map((child) => write(child, false, depth + 1)).join('')}</${node.tagName}>`;
  };
  return write(root, true, 0);
}

/** Finds the template's body slot (`id="qp-body-slot"`, `QUESTION_PAPER_SLOT`) and the elements around it, outermost first. */
function slotPath(document: Node): Element[] | null {
  for (const element of elementsOf(document)) {
    if (attributeOf(element, 'id') === 'qp-body-slot') {
      const path: Element[] = [element];
      for (let parent = element.parentNode as Node | null; parent && isElement(parent); parent = parent.parentNode as Node | null) path.unshift(parent);
      return path;
    }
  }
  return null;
}

const styleSheetsOf = (root: Node) =>
  elementsOf(root)
    .filter((element) => element.tagName === 'style')
    .map((element) => textOf(element));

/**
 * The Word-friendly HTML of a saved version (see the file note). `fragment` is
 * the stored fragment: it is sanitised here first. `template` is the rendered
 * template document with the slot in place. `figures` are the data URIs
 * `loadFigureAssets` loaded (only this paper's own images).
 */
export function questionPaperDocxHtml(input: { fragment: string; figures: FigureAssets; template: string }): QuestionPaperDocxHtml {
  const sanitized = sanitizeQuestionPaperBody(input.fragment);
  if (sanitized.refused) throw rpcError.badRequest(`This paper cannot be converted: ${sanitized.problems[0] ?? 'it could not be cleaned safely.'}`);

  const converter = new Converter(input.figures);
  const document = parse(input.template, { scriptingEnabled: false });
  if (elementsOf(document).length > MAX_TEMPLATE_ELEMENTS) throw rpcError.badRequest('The school’s question paper template is too complex to convert to Word.');
  const path = slotPath(document);
  if (!path) throw new Error('The rendered question paper template has no body slot.');

  // Heading: down the slot's ancestors, everything before the next ancestor on the way. Trailer: on the way back up,
  // everything after it. Each ancestor's context is kept for its children, so the body inherits direction and alignment.
  // Converted in the order they are written (heading, body, trailer), so the tables are recorded in Pandoc's order.
  const templateCascade = new Cascade(styleSheetsOf(document));
  converter.use(templateCascade);
  const contexts: Ctx[] = [];
  let ctx = ROOT_CTX;
  let heading = '';
  for (let index = 0; index < path.length - 1; index += 1) {
    const element = path[index]!;
    if (index > 0) ctx = converter.childCtx(element, ctx);
    contexts.push(ctx);
    heading += converter.blocks(element, ctx, 0, childrenOf(element).indexOf(path[index + 1]!));
  }
  const bodyCtx = converter.childCtx(path.at(-1)!, ctx);

  const fragment = parseFragment(`<div class="${QUESTION_PAPER_BODY_CLASS}">${sanitized.html}</div>`, { scriptingEnabled: false });
  const wrapper = elementChildren(fragment)[0];
  if (!wrapper) throw new Error('The sanitised fragment did not parse.');
  converter.use(new Cascade([questionPaperBodyCss(), ...styleSheetsOf(wrapper)]));
  const body = converter.blocks(wrapper, bodyCtx);

  converter.use(templateCascade);
  let trailer = '';
  for (let index = path.length - 2; index >= 0; index -= 1) {
    const element = path[index]!;
    trailer += converter.blocks(element, contexts[index]!, childrenOf(element).indexOf(path[index + 1]!) + 1);
  }
  const footer = converter.footer();

  return {
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${heading}${body}${trailer}</body></html>`,
    tables: converter.tables,
    images: converter.imageFiles(),
    svgs: converter.svgs,
    footer,
  };
}
