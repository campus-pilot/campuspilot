import { QUESTION_PAPER_LIMITS as L } from '@campuspilot/question-paper/limits';
import sanitizeHtml from 'sanitize-html';

import { BASE_SANITIZER_OPTIONS } from '../document/document.sanitize';
import { cleanDeclarations, cleanStyleSheet, StripReport } from './question-paper.css';

/**
 * The `question_paper_body` sanitiser profile (html-design.md): the HTML
 * fragment of a question paper is written by a model that photographs and
 * prompts can steer, so it is UNTRUSTED. This profile turns it into a fragment
 * that is safe to place in the PDF document, built on the same sanitize-html
 * configuration base as every other document (`document.sanitize.ts`) and
 * stricter in what it allows:
 *
 * - Tags: the paper vocabulary (text, lists, tables, figure, an image that
 *   carries only a figure id) and a small inline SVG subset. Everything else is
 *   dropped: script, iframe, object, embed, foreignObject, forms, link, meta,
 *   svg `use`/`image`, all with their content, and any SVG or HTML animation
 *   element (`animate`, `animateTransform`, `animateMotion`, `set`), reported in
 *   their own words because a model asked for "an engaging diagram" reaches for
 *   them.
 * - Attributes: an allowlist per element, each value validated. No `href`,
 *   `src`, event handler, `id` or `xmlns`. An image has no `src`: it names an
 *   uploaded figure by `data-figure-id` and the renderer inserts the data URI
 *   after sanitising. A formula is an empty `span` with `data-math`.
 * - CSS: `<style>` and `style=""` are cleaned by `question-paper.css.ts`
 *   (property allowlist, no urls, no at-rules, no motion, selectors scoped to
 *   the body wrapper).
 * - Size: the work done on the input and the size of the result are capped
 *   ({@link QUESTION_PAPER_LIMITS}); over a cap is reported as a `problem`
 *   (a blocking finding), never silently truncated.
 *
 * Cleaning is idempotent: cleaning its own output changes nothing and reports
 * nothing, because the renderer cleans the stored fragment again (defence in
 * depth). `stripped` lists what was removed or changed, for the user;
 * `problems` lists what makes the paper unusable and must be fixed.
 */

export const QUESTION_PAPER_HTML_TAGS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'br', 'hr', 'b', 'i', 'u', 'sup', 'sub', 'strong', 'em', 'figure', 'figcaption', 'img', 'style',
] as const;

/** The inline SVG subset. All inert shapes and text; nothing that references, loads or moves. */
export const QUESTION_PAPER_SVG_TAGS = [
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text', 'tspan',
] as const;

const ALLOWED_TAGS = new Set<string>([...QUESTION_PAPER_HTML_TAGS, ...QUESTION_PAPER_SVG_TAGS]);
/** SVG-only names (`svg` itself is counted separately). */
const SVG_PARTS = new Set<string>(QUESTION_PAPER_SVG_TAGS.filter((tag) => tag !== 'svg'));

/** Animation and motion elements, reported with their own message. */
const MOTION_TAGS = new Set(['animate', 'animatemotion', 'animatetransform', 'set', 'mpath', 'discard']);

/** Elements removed with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  ...MOTION_TAGS,
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'foreignobject', 'noscript', 'template',
  'textarea', 'select', 'option', 'optgroup', 'datalist', 'input', 'button', 'form', 'link', 'meta', 'base',
  'audio', 'video', 'source', 'track', 'canvas', 'math', 'use', 'image', 'title', 'head', 'xmp', 'noembed', 'noframes', 'plaintext',
]);

/** Wrappers a model adds out of habit; unwrapped without a finding. */
const UNWRAP_SILENTLY = new Set(['html', 'body']);

const FIGURE_ID = /^(?:asat|qpf)_[0-9a-z]{21}$/;
const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const CLASS_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/;
/** Class names the renderer and the page frame use: a fragment cannot borrow them. */
const RESERVED_CLASS = /^(?:qp-|katex|question-paper)/;
const COLOUR = /^(?:none|currentcolor|transparent|#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([0-9., %]{3,40}\))$/i;
const NUMBER_LIST = /^[0-9eE+\-., %a-z]{0,2000}$/;
const FORBIDDEN_ATTRIBUTE_VALUE = /url\s*\(|javascript|data:|expression|@import|[<>\\]/i;

type Cleaner = (value: string) => string | null;

const integer = (min: number, max: number): Cleaner => (value) => {
  if (!/^-?\d{1,6}$/.test(value.trim())) return null;
  const number = Number(value);
  return number >= min && number <= max ? String(number) : null;
};
const oneOf = (...words: string[]): Cleaner => (value) => (words.includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null);
const pattern = (regex: RegExp): Cleaner => (value) => (regex.test(value.trim()) && !FORBIDDEN_ATTRIBUTE_VALUE.test(value) ? value.trim() : null);

/** SVG presentation and geometry attributes, by name. */
const SVG_ATTRIBUTES: Record<string, Cleaner> = {
  viewbox: pattern(/^[0-9eE+\-., ]{1,100}$/),
  width: pattern(NUMBER_LIST),
  height: pattern(NUMBER_LIST),
  preserveaspectratio: pattern(/^[A-Za-z ]{1,40}$/),
  role: oneOf('img', 'presentation', 'none'),
  'aria-label': (value) => (value.length <= L.altChars && !/[\u0000-\u001f]/.test(value) ? value : null),
  'aria-hidden': oneOf('true', 'false'),
  x: pattern(NUMBER_LIST), y: pattern(NUMBER_LIST), dx: pattern(NUMBER_LIST), dy: pattern(NUMBER_LIST),
  x1: pattern(NUMBER_LIST), y1: pattern(NUMBER_LIST), x2: pattern(NUMBER_LIST), y2: pattern(NUMBER_LIST),
  cx: pattern(NUMBER_LIST), cy: pattern(NUMBER_LIST), r: pattern(NUMBER_LIST), rx: pattern(NUMBER_LIST), ry: pattern(NUMBER_LIST),
  rotate: pattern(NUMBER_LIST),
  d: pattern(/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-., \n\t\r]{0,20000}$/),
  points: pattern(/^[0-9eE+\-., \n\t\r]{0,20000}$/),
  transform: pattern(/^(?:\s*(?:translate|rotate|scale|skewX|skewY|matrix)\s*\([0-9eE+\-.,\s]{0,200}\)\s*,?){0,12}$/),
  fill: pattern(COLOUR),
  stroke: pattern(COLOUR),
  'stroke-width': pattern(NUMBER_LIST),
  'stroke-dasharray': pattern(NUMBER_LIST),
  'stroke-dashoffset': pattern(NUMBER_LIST),
  'stroke-opacity': pattern(NUMBER_LIST),
  'fill-opacity': pattern(NUMBER_LIST),
  opacity: pattern(NUMBER_LIST),
  'stroke-linecap': oneOf('butt', 'round', 'square'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel'),
  'fill-rule': oneOf('nonzero', 'evenodd'),
  'text-anchor': oneOf('start', 'middle', 'end'),
  'dominant-baseline': oneOf('auto', 'middle', 'central', 'hanging', 'alphabetic', 'text-bottom', 'text-top', 'ideographic', 'mathematical'),
  'font-size': pattern(NUMBER_LIST),
  'font-weight': pattern(/^(?:normal|bold|[1-9]00)$/),
  'font-style': oneOf('normal', 'italic', 'oblique'),
  'letter-spacing': pattern(NUMBER_LIST),
  'font-family': (value) => {
    const css = cleanDeclarations(`font-family:${value}`, new StripReport());
    return css === '' ? null : css.slice('font-family:'.length);
  },
};

/** Attributes of specific HTML elements. */
const HTML_ATTRIBUTES: Record<string, Record<string, Cleaner>> = {
  td: { colspan: integer(1, 50), rowspan: integer(1, 50) },
  th: { colspan: integer(1, 50), rowspan: integer(1, 50), scope: oneOf('row', 'col', 'rowgroup', 'colgroup') },
  col: { span: integer(1, 50) },
  colgroup: { span: integer(1, 50) },
  ol: { start: integer(-9999, 9999) },
  li: { value: integer(-9999, 9999) },
  img: { width: integer(1, 1500), height: integer(1, 1500) },
};

const EVENT_HANDLER = /^on/i;
/** Attributes that carry nothing a paper needs; dropped without a finding. */
const SILENT_ATTRIBUTES = /^(?:xmlns|xmlns:.*|version|xml:space|xml:lang|baseprofile|focusable|tabindex)$/i;

export type SanitizedQuestionPaperBody = {
  /** The cleaned fragment, safe to place inside the body wrapper. Empty when it could not be cleaned. */
  html: string;
  /** What was removed or changed, one line per kind, for the user. Not blocking. */
  stripped: string[];
  /** What makes the paper unusable (a cap exceeded). Blocking. */
  problems: string[];
  stats: {
    /** Characters of the input. */
    inputChars: number;
    elements: number;
    svgs: number;
    svgElements: number;
    styleChars: number;
    /** `data-math` expressions. */
    mathNodes: number;
    /** The longest `data-math` expression. */
    longestMath: number;
    /** Distinct valid figure ids, in document order. */
    figureIds: string[];
    placeholders: number;
  };
};

const emptyStats = (inputChars: number): SanitizedQuestionPaperBody['stats'] => ({
  inputChars,
  elements: 0,
  svgs: 0,
  svgElements: 0,
  styleChars: 0,
  mathNodes: 0,
  longestMath: 0,
  figureIds: [],
  placeholders: 0,
});

const number = (value: number) => value.toLocaleString('en-IN');

/**
 * Cleans a model's HTML fragment with the `question_paper_body` profile. Pure
 * and synchronous; the input is never executed, fetched or evaluated.
 */
export function sanitizeQuestionPaperBody(raw: string): SanitizedQuestionPaperBody {
  const stats = emptyStats(raw.length);
  if (raw.length > L.parseChars) {
    return {
      html: '',
      stripped: [],
      problems: [`The paper is ${number(raw.length)} characters; the limit is ${number(L.fragmentChars)}. Make it shorter.`],
      stats,
    };
  }

  const report = new StripReport();
  const figureIds = new Set<string>();

  const cleanAttributes = (tag: string, attributes: Record<string, string>): Record<string, string> => {
    const clean: Record<string, string> = {};
    const isSvg = tag === 'svg' || SVG_PARTS.has(tag);
    for (const [name, value] of Object.entries(attributes)) {
      const lower = name.toLowerCase();
      if (SILENT_ATTRIBUTES.test(lower)) continue;
      if (EVENT_HANDLER.test(lower)) {
        report.add(`The event handler "${lower}" was removed`);
        continue;
      }
      let cleaned: string | null | undefined;
      if (lower === 'class') {
        const tokens = value.split(/\s+/).filter(Boolean);
        const kept = tokens.filter((token) => CLASS_TOKEN.test(token) && !RESERVED_CLASS.test(token));
        if (kept.length < tokens.length) report.add('A class name that is invalid or reserved by the page was removed');
        cleaned = kept.join(' ');
      } else if (lower === 'lang') cleaned = LANG.test(value.trim()) ? value.trim() : null;
      else if (lower === 'dir') cleaned = oneOf('ltr', 'rtl', 'auto')(value);
      else if (lower === 'style') {
        cleaned = cleanDeclarations(value, report);
        if (cleaned !== '' && /url\s*\(/i.test(cleaned)) cleaned = '';
      } else if (lower === 'data-math' && tag === 'span') {
        cleaned = value.normalize('NFC').trim();
        if (cleaned === '') cleaned = null;
      } else if (lower === 'data-display' && tag === 'span') cleaned = /^(?:true|)$/i.test(value.trim()) ? 'true' : null;
      else if (lower === 'data-figure-id' && (tag === 'img' || tag === 'figure')) {
        cleaned = FIGURE_ID.test(value.trim()) ? value.trim() : null;
        if (cleaned === null) report.add('A figure id that is not an asat_ or qpf_ id was removed');
        else figureIds.add(cleaned);
        if (cleaned === null) continue;
      } else if (lower === 'data-placeholder' && tag === 'figure') {
        cleaned = value.replace(/\s+/g, ' ').trim().slice(0, L.placeholderChars);
        if (cleaned === '') cleaned = null;
      } else if (lower === 'alt' && tag === 'img') cleaned = value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, L.altChars);
      else if (isSvg && SVG_ATTRIBUTES[lower]) cleaned = SVG_ATTRIBUTES[lower]!(value);
      else if (HTML_ATTRIBUTES[tag]?.[lower]) cleaned = HTML_ATTRIBUTES[tag]![lower]!(value);
      else {
        report.add(`The attribute "${lower}" on <${tag}> is not allowed and was removed`);
        continue;
      }
      if (cleaned === null || cleaned === undefined) {
        report.add(`The attribute "${lower}" on <${tag}> had a value that is not allowed and was removed`);
        continue;
      }
      if (cleaned === '' && lower !== 'alt') continue;
      clean[lower] = cleaned;
    }
    if (tag === 'span' && clean['data-display'] !== undefined && clean['data-math'] === undefined) delete clean['data-display'];
    return clean;
  };

  const html = sanitizeHtml(raw, {
    ...BASE_SANITIZER_OPTIONS,
    // The tags removed with their content are listed as allowed on purpose: sanitize-html only runs `exclusiveFilter`
    // (the one hook that removes a whole subtree) for tags it allows, and a disallowed tag would lose only its own
    // markup and leave the children behind (a <div> inside <foreignObject>). `exclusiveFilter` below removes them.
    allowedTags: [...ALLOWED_TAGS, ...DROP_WITH_CONTENT],
    allowedAttributes: false,
    parseStyleAttributes: false,
    disallowedTagsMode: 'discard',
    // A bound on nesting: deeper elements are dropped (their text is kept).
    nestingLimit: 40,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'xmp', 'noscript', 'template', 'noembed', 'noframes', 'plaintext', 'title', 'head', 'select', 'datalist'],
    transformTags: {
      '*': (tagName, attribs) => {
        const tag = tagName.toLowerCase();
        if (MOTION_TAGS.has(tag)) {
          report.add(`Animation or motion "<${tag}>" was removed (a paper is printed, nothing moves)`);
          return { tagName: tag, attribs: {} };
        }
        if (DROP_WITH_CONTENT.has(tag)) {
          report.add(`<${tag}> was removed with its content`);
          return { tagName: tag, attribs: {} };
        }
        if (!ALLOWED_TAGS.has(tag)) {
          // A model often wraps a fragment in <html><body>: unwrapping them is not worth a finding.
          if (!UNWRAP_SILENTLY.has(tag)) report.add(`<${tag}> is not allowed; its tag was removed and its text kept`);
          return { tagName: tag, attribs: {} };
        }
        // `style` is allowed as an element, not as a carrier of attributes.
        const clean = tag === 'style' ? {} : cleanAttributes(tag, attribs);
        if (tag !== 'style') {
          stats.elements += 1;
          if (tag === 'svg') stats.svgs += 1;
          if (SVG_PARTS.has(tag)) stats.svgElements += 1;
          if (clean['data-math'] !== undefined) {
            stats.mathNodes += 1;
            stats.longestMath = Math.max(stats.longestMath, clean['data-math'].length);
          }
          if (tag === 'figure' && clean['data-placeholder'] !== undefined) stats.placeholders += 1;
        }
        return { tagName: tag, attribs: clean };
      },
    },
    exclusiveFilter: (frame) => {
      const tag = frame.tag.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) return true;
      if (tag === 'img' && frame.attribs['data-figure-id'] === undefined) {
        report.add('An image without a valid data-figure-id was removed (images must name an uploaded figure)');
        return true;
      }
      return false;
    },
  });

  const cleaned = cleanStyleElements(html, report, stats);
  stats.figureIds = [...figureIds];

  const problems: string[] = [];
  if (cleaned.length > L.fragmentChars) problems.push(`The paper is ${number(cleaned.length)} characters after cleaning; the limit is ${number(L.fragmentChars)}. Make it shorter.`);
  if (stats.elements > L.elements) problems.push(`The paper has ${number(stats.elements)} elements; the limit is ${number(L.elements)}. Simplify the markup.`);
  if (stats.svgs > L.svgs) problems.push(`The paper has ${stats.svgs} SVG drawings; the limit is ${L.svgs}.`);
  if (stats.svgElements > L.svgElements) problems.push(`The SVG drawings have ${number(stats.svgElements)} shapes in all; the limit is ${number(L.svgElements)}.`);
  if (stats.styleChars > L.styleChars) problems.push(`The <style> blocks are ${number(stats.styleChars)} characters; the limit is ${number(L.styleChars)}. Use fewer, shorter rules.`);
  if (stats.mathNodes > L.mathNodes) problems.push(`The paper has ${stats.mathNodes} formulas; the limit is ${L.mathNodes}.`);
  if (stats.longestMath > L.texChars) problems.push(`A formula is ${stats.longestMath} characters; the limit is ${L.texChars}. Split it.`);
  if (stats.figureIds.length + stats.placeholders > L.figures) problems.push(`The paper has ${stats.figureIds.length + stats.placeholders} figures and placeholders; the limit is ${L.figures}.`);

  return { html: cleaned, stripped: report.lines(), problems, stats };
}

const STYLE_OPEN = '<style>';
const STYLE_CLOSE = '</style>';

/**
 * Replaces the text of every `<style>` element of already-sanitised markup with
 * its cleaned CSS. sanitize-html passes a style element's text through
 * verbatim (it is raw text), so this is where it is checked. In the sanitiser's
 * output a literal `<style>` can only be a real element (text and attribute
 * values have their `<` escaped), and its text ends at the first `</style>`, in
 * HTML and inside an `<svg>` alike. Text containing `<` is dropped whole by
 * {@link cleanStyleSheet}, so no markup can be hidden in it.
 */
function cleanStyleElements(html: string, report: StripReport, stats: SanitizedQuestionPaperBody['stats']): string {
  let output = '';
  let index = 0;
  const lowered = html.toLowerCase();
  for (;;) {
    const open = lowered.indexOf(STYLE_OPEN, index);
    if (open < 0) break;
    const textStart = open + STYLE_OPEN.length;
    const close = lowered.indexOf(STYLE_CLOSE, textStart);
    const textEnd = close < 0 ? html.length : close;
    const text = html.slice(textStart, textEnd);
    stats.styleChars += text.length;
    const css = stats.styleChars > L.styleChars * 2 ? '' : cleanStyleSheet(text, report, (name) => ALLOWED_TAGS.has(name));
    // A style element with nothing left is dropped rather than kept empty.
    output += html.slice(index, open) + (css === '' ? '' : `${STYLE_OPEN}${css}${STYLE_CLOSE}`);
    index = close < 0 ? html.length : close + STYLE_CLOSE.length;
  }
  return output + html.slice(index);
}
