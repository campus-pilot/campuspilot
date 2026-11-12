import { rpcError } from '../../../errors';
import { QUESTION_PAPER_BODY_CLASS } from './question-paper.css';
import { katexInlineCss, renderMathSpans, type MathRenderer } from './question-paper.math';
import { sanitizeQuestionPaperBody } from './question-paper.sanitize';

/**
 * The stored HTML fragment of a question paper to the HTML that fills the
 * template's body slot (html-design.md).
 *
 * TRUST BOUNDARY. The fragment is a model's output and therefore UNTRUSTED. The
 * pipeline is, in this order:
 *
 * 1. the stored fragment is sanitised AGAIN with the `question_paper_body`
 *    profile ({@link sanitizeQuestionPaperBody}); it was sanitised when it was
 *    saved, so this is defence in depth and costs little. Everything after this
 *    step works on the sanitiser's output, never on the stored text;
 * 2. figure ids are swapped for the stored images and placeholders become the
 *    dashed labelled box;
 * 3. `<span data-math>` formulas become server-typeset KaTeX markup;
 * 4. the stylesheet and the wrapper are added.
 *
 * Only two things are inserted AFTER sanitising, and both come from our code:
 * (a) the data URIs of figures the caller loaded from this paper's own stored
 * images, and (b) KaTeX output produced from the formula's plain LaTeX string
 * (`trust: false`, no macros). The model supplies a figure id and a LaTeX
 * string and nothing else of either. The result is then inserted into the
 * template document without a second sanitising pass (see `QUESTION_PAPER_SLOT`).
 * Do not insert anything else after step 1 without repeating that review.
 */

/** The size the final document (template output plus body) may reach; the document system's limit. */
export const QUESTION_PAPER_DOCUMENT_MAX_BYTES = 25_000_000;
/**
 * The template alone is rendered under this budget (the same as notices),
 * with the slot placeholder as the body: the body's size can therefore never
 * be multiplied by the template, which prints a constant string.
 */
export const QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS = 2_000_000;
/** How many times one paper may show the school logo (letterhead, footer, watermark). */
export const QUESTION_PAPER_MAX_LOGO_USES = 3;
/** What the template can add around the body: its whole budget at 3 UTF-8 bytes a character, plus the logo at most 1 MB a use. */
const TEMPLATE_RESERVE_BYTES = QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS * 3 + QUESTION_PAPER_MAX_LOGO_USES * 1_000_000;
/**
 * The body (fragment, KaTeX markup, figures, stylesheet) may be this large:
 * whatever is left of the document limit after the template's worst case, so a
 * body that passes this check can always be placed in the template and printed
 * (the final check in `renderQuestionPaperDocument` is only a backstop).
 */
export const QUESTION_PAPER_BODY_MAX_BYTES = QUESTION_PAPER_DOCUMENT_MAX_BYTES - TEMPLATE_RESERVE_BYTES;
/** The figures, as data URIs, are part of the body: they leave room for the fragment (80,000 characters) and the KaTeX markup. */
export const QUESTION_PAPER_FIGURES_MAX_BYTES = 12_000_000;

/** A figure image ready to print: a data URI built from the paper's stored figure or the user's chat attachment. */
export type FigureAsset = { dataUri: string };
export type FigureAssets = ReadonlyMap<string, FigureAsset>;

export type RenderedBody = {
  html: string;
  hasMath: boolean;
  /** Uploaded figures and placeholders printed. */
  figureCount: number;
  byteSize: number;
  /** Findings that did not stop the render (a formula that failed at print time, a figure that could not be found). */
  warnings: string[];
};

const FIGURE_PLACEHOLDER_LABEL = 'Figure to be added';
const FIGURE_MISSING_LABEL = 'Figure unavailable';

/**
 * Presentation defaults by language, from the Noto families installed in the
 * PDF converter (design A9). Chromium also falls back by script on its own;
 * this only makes the choice explicit. It reads the paper's own `lang`
 * attributes and states no fact about the paper.
 */
const LANGUAGE_FONTS: ReadonlyArray<readonly [langs: readonly string[], family: string]> = [
  [['hi', 'mr', 'sa', 'ne'], "'Noto Sans Devanagari','Noto Sans',sans-serif"],
  [['bn', 'as'], "'Noto Sans Bengali','Noto Sans',sans-serif"],
  [['ta'], "'Noto Sans Tamil','Noto Sans',sans-serif"],
  [['te'], "'Noto Sans Telugu','Noto Sans',sans-serif"],
  [['kn'], "'Noto Sans Kannada','Noto Sans',sans-serif"],
  [['ml'], "'Noto Sans Malayalam','Noto Sans',sans-serif"],
  [['gu'], "'Noto Sans Gujarati','Noto Sans',sans-serif"],
  [['pa'], "'Noto Sans Gurmukhi','Noto Sans',sans-serif"],
  [['or'], "'Noto Sans Oriya','Noto Sans',sans-serif"],
  [['ur', 'ar', 'fa', 'sd'], "'Noto Naskh Arabic','Noto Nastaliq Urdu','Noto Sans Arabic','Noto Sans',sans-serif"],
];

/** The default stylesheet of the body: constants only. The model's own `<style>` rules come after it and are scoped. */
function bodyCss(): string {
  const root = `.${QUESTION_PAPER_BODY_CLASS}`;
  const fonts = LANGUAGE_FONTS.map(([langs, family]) => `${root} :is(${langs.map((lang) => `:lang(${lang})`).join(',')}){font-family:${family}}`).join('');
  return (
    `${root}{font-size:11pt;line-height:1.45;overflow-wrap:anywhere;font-family:'Noto Sans','DejaVu Sans',Arial,sans-serif}` +
    fonts +
    `${root} h1{font-size:14pt;text-align:center;margin:0 0 4mm}` +
    `${root} h2{font-size:12pt;margin:4mm 0 2mm;break-after:avoid}` +
    `${root} h3,${root} h4{font-size:11pt;margin:3mm 0 1.5mm;break-after:avoid}` +
    `${root} p{margin:1mm 0}` +
    `${root} ul,${root} ol{margin:1mm 0;padding-inline-start:6mm}` +
    `${root} table{border-collapse:collapse;margin:2mm 0;max-width:100%}` +
    `${root} th,${root} td{border:0.3mm solid #000;padding:1mm 2mm;vertical-align:top;text-align:start}` +
    `${root} caption{caption-side:top;text-align:start;font-weight:600;padding-bottom:1mm}` +
    `${root} img,${root} svg{max-width:100%;height:auto}` +
    `${root} figure{margin:2mm auto;text-align:center;break-inside:avoid}` +
    `${root} figcaption{font-size:9.5pt}` +
    `${root} .qp-figure-placeholder{border:0.3mm dashed #555;padding:4mm;font-size:10pt;color:#333}` +
    `${root} .qp-math,${root} .qp-math-display{direction:ltr;unicode-bidi:isolate}` +
    `${root} .qp-math-display{display:block;margin:1mm 0;text-align:center;break-inside:avoid}` +
    `${root} .qp-math-display .katex-display{margin:0}` +
    `${root} .qp-math-error{font-family:monospace;color:#8a1c1c}`
  );
}

/** Why a body over {@link QUESTION_PAPER_BODY_MAX_BYTES} is refused (at print time and by the draft check alike). */
export const BODY_TOO_LARGE_MESSAGE = 'This paper is too large to print. Remove some figures or formulas, or split it.';

/**
 * The printed body: the default stylesheet (with KaTeX's when the paper has a formula) and the wrapper around the
 * typeset content. The ONE place this is assembled, used by the renderer and by {@link estimatedBodyBytes}.
 */
function composeBody(contentHtml: string, hasMath: boolean): string {
  return `<style>${bodyCss()}${hasMath ? katexInlineCss() : ''}</style><div class="${QUESTION_PAPER_BODY_CLASS}">${contentHtml}</div>`;
}

/** Markup a figure adds on top of its data URI once placed (`<img src="" alt="">`, `<figure>`), counted per figure in the estimate. */
const FIGURE_MARKUP_BYTES = 64;

/**
 * The size the printed body will have, before the figures are loaded: the exact
 * size {@link renderQuestionPaperBodyHtml} measures (same assembly, same unit)
 * for `typesetHtml` (the fragment after {@link renderMathSpans}, figures not yet
 * placed), plus the base64 data URI bytes of the figures that will be placed.
 * Compared to {@link QUESTION_PAPER_BODY_MAX_BYTES}, this is the ONE budget the
 * draft check and the print share, so a draft that passes the check cannot be
 * refused for size at print time (the estimate counts a figure's markup twice
 * over: the unplaced `data-figure-id` tag is already in `typesetHtml`).
 */
export function estimatedBodyBytes(input: { typesetHtml: string; hasMath: boolean; figureBytes: number; figureCount: number }): number {
  return Buffer.byteLength(composeBody(input.typesetHtml, input.hasMath), 'utf8') + input.figureBytes + input.figureCount * FIGURE_MARKUP_BYTES;
}

/** The attributes of one tag as sanitize-html wrote them (quoted, `>` escaped), by name. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  // The lookbehind keeps a long run of letters from being rescanned from every position (see `findMathSpans`).
  for (const match of tag.matchAll(/(?<![a-z-])([a-z][a-z-]*)="([^"]*)"/g)) attributes.set(match[1]!, match[2]!);
  return attributes;
}

type FigureState = { figureCount: number; warnings: string[] };

// `[^<>]*`, not `[^>]*`: the same tags in sanitiser output (no `<` or `>` inside a tag), but linear on any other text.
const FIGURE_TAG = /<figure\b[^<>]*>/g;
const IMG_TAG = /<img\b[^<>]*>/g;

/**
 * Swaps figure ids for images and placeholder descriptions for the dashed box,
 * working on sanitiser output. The data URI never contains a quote or `>`
 * (it is built by the caller from a stored image), and a description is
 * attribute text from the sanitiser, which has already escaped it.
 */
function placeFigures(html: string, figures: FigureAssets, state: FigureState): string {
  const missing = (id: string) => {
    state.warnings.push(`The figure ${id} could not be found, so it was not printed.`);
    return `<span class="qp-figure-placeholder">${FIGURE_MISSING_LABEL}</span>`;
  };
  const withImages = html.replace(IMG_TAG, (tag) => {
    const id = attributesOf(tag).get('data-figure-id');
    if (id === undefined) return tag;
    const asset = figures.get(id);
    if (!asset) return missing(id);
    state.figureCount += 1;
    return tag.replace(/\sdata-figure-id="[^"]*"/, ` src="${asset.dataUri}"`).replace(/\s*\/>$/, '>');
  });

  let output = '';
  let at = 0;
  for (const match of withImages.matchAll(FIGURE_TAG)) {
    const tag = match[0];
    const attributes = attributesOf(tag);
    const id = attributes.get('data-figure-id');
    const description = attributes.get('data-placeholder');
    if (id === undefined && description === undefined) continue;
    const start = match.index;
    output += withImages.slice(at, start);
    at = start + tag.length;
    const style = attributes.get('style');
    const styleAttribute = style ? ` style="${style}"` : '';
    if (description !== undefined && id === undefined) {
      state.figureCount += 1;
      output += `<figure class="qp-figure-placeholder"${styleAttribute}><div>${FIGURE_PLACEHOLDER_LABEL}</div><div>${description}</div>`;
      continue;
    }
    // A figure that names an image: the image is placed first unless the figure already holds an <img>.
    const close = withImages.indexOf('</figure>', at);
    const holdsImage = withImages.slice(at, close < 0 ? withImages.length : close).includes('<img');
    const asset = figures.get(id!);
    const classAttribute = attributes.get('class') ? ` class="${attributes.get('class')}"` : '';
    output += `<figure${classAttribute}${styleAttribute}>`;
    if (holdsImage) continue;
    if (!asset) output += missing(id!);
    else {
      state.figureCount += 1;
      output += `<img src="${asset.dataUri}" alt="">`;
    }
  }
  return output + withImages.slice(at);
}

/**
 * Renders a stored fragment to the HTML fragment that fills the template's
 * body slot (see the trust boundary above). Pure: the same fragment, figures and
 * KaTeX version always give the same bytes. A figure id missing from `figures`
 * prints as a note and a warning (see `loadFigureAssets`, which leaves out ids
 * that are not this paper's), and a formula that fails prints as its raw LaTeX
 * and a warning: a stored version renders, except one the sanitiser now refuses
 * (BAD_REQUEST) or one over the body size limit.
 */
export function renderQuestionPaperBodyHtml(
  fragment: string,
  input: { figures: FigureAssets; math: MathRenderer },
): RenderedBody {
  const sanitized = sanitizeQuestionPaperBody(fragment);
  // Stored versions were cleaned when they were saved, so this only trips if the cleaning rules changed under a stored
  // fragment: refuse to print rather than print something that was not verified.
  if (sanitized.refused) throw rpcError.badRequest(`This paper cannot be printed: ${sanitized.problems[0] ?? 'it could not be cleaned safely.'}`);
  const state: FigureState = { figureCount: 0, warnings: [] };
  const withFigures = placeFigures(sanitized.html, input.figures, state);
  const math = renderMathSpans(withFigures, input.math);
  const hasMath = math.count > 0;
  const warnings = [...state.warnings, ...math.failures.map((failure) => `Formula ${failure.index} was printed as plain text: ${failure.message}`)];
  const html = composeBody(math.html, hasMath);
  const byteSize = Buffer.byteLength(html, 'utf8');
  if (byteSize > QUESTION_PAPER_BODY_MAX_BYTES) {
    throw rpcError.badRequest(BODY_TOO_LARGE_MESSAGE);
  }
  return { html, hasMath, figureCount: state.figureCount, byteSize, warnings };
}

/** The stored fragment's figure ids, in document order, without repeats (after the same sanitising the renderer applies). */
export function fragmentFigureIds(fragment: string): string[] {
  return sanitizeQuestionPaperBody(fragment).stats.figureIds;
}

/**
 * Turns the figure ids in `unresolved` into placeholders, working on sanitiser
 * output (so ids and attribute values are quoted and escaped). An image with an
 * unusable id becomes a placeholder figure described by its `alt` text; a
 * figure that names one keeps its other content (a caption) and gets the
 * description instead of the id. Used when nothing can attach an image (the AI
 * job): the paper then still prints, with a labelled box where the figure goes.
 */
export function figureIdsToPlaceholders(sanitizedHtml: string, unresolved: ReadonlySet<string>): string {
  const described = (attributes: Map<string, string>) => attributes.get('alt') || attributes.get('data-placeholder') || 'Figure';
  return sanitizedHtml
    .replace(IMG_TAG, (tag) => {
      const attributes = attributesOf(tag);
      const id = attributes.get('data-figure-id');
      return id !== undefined && unresolved.has(id) ? `<figure data-placeholder="${described(attributes)}"></figure>` : tag;
    })
    .replace(FIGURE_TAG, (tag) => {
      const attributes = attributesOf(tag);
      const id = attributes.get('data-figure-id');
      if (id === undefined || !unresolved.has(id)) return tag;
      return tag.replace(/\sdata-figure-id="[^"]*"/, attributes.has('data-placeholder') ? '' : ` data-placeholder="Figure"`);
    });
}
