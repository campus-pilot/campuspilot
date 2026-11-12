import { QUESTION_PAPER_LIMITS as L } from '@campuspilot/question-paper/limits';
import { randomBytes } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

import { BASE_SANITIZER_OPTIONS } from '../document/document.sanitize';
import { cleanDeclarations, cleanStyleSheet, RESERVED_CLASS, StripReport, UNIT_CAP } from './question-paper.css';
import { scanQuestionPaperOutput, type ScannedElement, type ScannedOutput } from './question-paper.output';
import { checkQuestionPaperTree } from './question-paper.tree';

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
 * Cleaning reaches a FIXED POINT: {@link sanitizeQuestionPaperBody} repeats the
 * cleaning until the output stops changing (a small bounded number of rounds;
 * if it does not settle the paper is refused and nothing is stored), so the
 * stored fragment is exactly what the renderer's second cleaning produces, and
 * the result is then checked by the exact grammar of `question-paper.output.ts`
 * (tag and attribute allowlists, no `on*`, one controlled kind of `<style>`),
 * which fails closed. A stable, accepted string must finally be read by a real
 * HTML tree builder (parse5, `question-paper.tree.ts`) inside the `.qp-body`
 * wrapper as the grammar read it; otherwise the browser's own reading becomes
 * the new text and the rounds go on (implied end tags would otherwise let a
 * later `</div>` close the wrapper). `stripped` lists what was removed or changed, for the
 * user; `problems` lists what makes the paper unusable and must be fixed.
 *
 * `<style>` is the one element whose text sanitize-html would emit verbatim
 * (and in an `<svg>` its parser decodes entities and CDATA first, so the text
 * can hold markup). So a style element is never left to it: each one becomes an
 * unguessable marker element before the text is emitted (escaped, like any
 * text), the marker's text is cleaned as CSS and written back as a plain
 * `<style>`; a `<style>` inside an `<svg>` is removed (put the CSS in a
 * `<style>` before the drawing, or in style attributes).
 */

export const QUESTION_PAPER_HTML_TAGS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'br', 'hr', 'b', 'i', 'u', 'sup', 'sub', 'strong', 'em', 'figure', 'figcaption', 'img', 'style',
] as const;

/** Stands for a style element that was inside an `<svg>`; removed with its content. */
const DROPPED_STYLE = 'qpdroppedstyle';

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
  DROPPED_STYLE,
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'foreignobject', 'noscript', 'template',
  'textarea', 'select', 'option', 'optgroup', 'datalist', 'input', 'button', 'form', 'link', 'meta', 'base',
  'audio', 'video', 'source', 'track', 'canvas', 'math', 'use', 'image', 'title', 'head', 'xmp', 'noembed', 'noframes', 'plaintext',
]);

/** Wrappers a model adds out of habit; unwrapped without a finding. */
const UNWRAP_SILENTLY = new Set(['html', 'body']);

/**
 * Element names the HTML and SVG standards define, which the profile does not allow (`section`, `font`, `defs`...).
 * Such a tag is unwrapped and its text kept, and that is right: the text is paper content. A name NOT in this set
 * (`thinking`, `analysis`, `scratchpad`) is not markup at all but a pseudo-tag a model uses to wrap its own reasoning
 * or answer, and its text is not necessarily the paper: {@link SanitizedQuestionPaperBody.structure} reports it so the
 * caller that has no human to look (the AI job) can ask for a repair instead of printing it. A closed standard list,
 * not a list of phrases or of known pseudo-tags.
 */
const STANDARD_ELEMENTS = new Set(
  (
    'a abbr acronym address area article aside audio bdi bdo big blockquote body button canvas center cite code data datalist dd del details dfn dialog dir dl dt ' +
    'fieldset figcaption font footer form frame frameset head header hgroup html iframe input ins kbd label legend link main map mark marquee menu meta meter nav nobr ' +
    'noscript object optgroup option output picture pre progress q rp rt ruby s samp script search section select slot small source span strike summary svg tbody ' +
    'template textarea time title tt var video wbr ' +
    'clippath defs desc filter foreignobject image lineargradient marker mask metadata mpath pattern radialgradient stop switch symbol use view'
  ).split(' '),
);

/** The most cleaning rounds before a fragment that keeps changing is refused. */
const MAX_ROUNDS = 4;

const FIGURE_ID = /^(?:asat|qpf)_[0-9a-z]{21}$/;
const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const CLASS_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/;
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
const NUMBER_TOKEN = /([+-]?(?:\d+\.?\d*|\.\d+))([eE][+-]?\d+)?([a-zA-Z%]*)/g;
/**
 * A list of SVG numbers (optionally with units) whose every number is at most
 * `max` in magnitude and, when not zero, at least `minNonZero`; no exponent
 * notation. An unbounded `stroke-dasharray` or coordinate would only make the
 * converter work for minutes, and a drawing is a few hundred units wide.
 */
const numbers = (max: number, minNonZero = 0): Cleaner => (value) => {
  const text = value.trim();
  if (!NUMBER_LIST.test(text) || FORBIDDEN_ATTRIBUTE_VALUE.test(text)) return null;
  for (const token of text.matchAll(NUMBER_TOKEN)) {
    if (token[2] !== undefined) return null;
    const unit = token[3]!.toLowerCase();
    if (unit !== '' && UNIT_CAP[unit] === undefined) return null;
    const amount = Math.abs(Number(token[1]));
    if (amount > max || (amount > 0 && amount < minNonZero)) return null;
  }
  return text;
};
/** The size of the drawing itself (`width`/`height` of the `<svg>`): one length, capped like a CSS length. */
const size: Cleaner = (value) => {
  const text = value.trim();
  // Length first: the pattern below backtracks quadratically over a long run of digits.
  if (text.length > 24) return null;
  const match = /^(\d+\.?\d*|\.\d+)([a-zA-Z%]*)$/.exec(text);
  if (!match) return null;
  const unit = match[2]!.toLowerCase();
  const cap = unit === '' ? UNIT_CAP['px']! : UNIT_CAP[unit];
  return cap !== undefined && Number(match[1]) <= cap ? text : null;
};
/** Path data and point lists: numbers and commands only, no exponent, bounded. */
const geometry = (regex: RegExp): Cleaner => (value) => {
  const text = value.trim();
  if (!regex.test(text) || /[eE][+-]?[\d.]/.test(text)) return null;
  for (const token of text.matchAll(/\d+\.?\d*|\.\d+/g)) if (Number(token[0]) > 100_000) return null;
  return text;
};
const pattern = (regex: RegExp): Cleaner => (value) => (regex.test(value.trim()) && !FORBIDDEN_ATTRIBUTE_VALUE.test(value) ? value.trim() : null);

/** SVG presentation and geometry attributes, by name. */
const SVG_ATTRIBUTES: Record<string, Cleaner> = {
  viewbox: geometry(/^[0-9eE+\-., ]{1,100}$/),
  width: size,
  height: size,
  preserveaspectratio: pattern(/^[A-Za-z ]{1,40}$/),
  role: oneOf('img', 'presentation', 'none'),
  'aria-label': (value) => (value.length <= L.altChars && !/[\u0000-\u001f]/.test(value) ? value : null),
  'aria-hidden': oneOf('true', 'false'),
  x: numbers(100_000), y: numbers(100_000), dx: numbers(100_000), dy: numbers(100_000),
  x1: numbers(100_000), y1: numbers(100_000), x2: numbers(100_000), y2: numbers(100_000),
  cx: numbers(100_000), cy: numbers(100_000), r: numbers(100_000), rx: numbers(100_000), ry: numbers(100_000),
  rotate: numbers(3_600),
  d: geometry(/^[MmLlHhVvCcSsQqTtAaZz0-9+\-., \n\t\r]{0,20000}$/),
  points: geometry(/^[0-9+\-., \n\t\r]{0,20000}$/),
  transform: geometry(/^(?:\s*(?:translate|rotate|scale|skewX|skewY|matrix)\s*\([0-9+\-.,\s]{0,200}\)\s*,?){0,12}$/),
  fill: pattern(COLOUR),
  stroke: pattern(COLOUR),
  'stroke-width': numbers(1_000),
  // A dash shorter than half a unit along a long line is millions of dashes for the converter to draw.
  'stroke-dasharray': numbers(10_000, 0.5),
  'stroke-dashoffset': numbers(10_000),
  'stroke-opacity': numbers(1),
  'fill-opacity': numbers(1),
  opacity: numbers(1),
  'stroke-linecap': oneOf('butt', 'round', 'square'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel'),
  'fill-rule': oneOf('nonzero', 'evenodd'),
  'text-anchor': oneOf('start', 'middle', 'end'),
  'dominant-baseline': oneOf('auto', 'middle', 'central', 'hanging', 'alphabetic', 'text-bottom', 'text-top', 'ideographic', 'mathematical'),
  'font-size': numbers(500),
  'font-weight': pattern(/^(?:normal|bold|[1-9]00)$/),
  'font-style': oneOf('normal', 'italic', 'oblique'),
  'letter-spacing': numbers(100),
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

/** The most characters of any attribute value the cleaners will look at. */
const MAX_ATTRIBUTE_CHARS = 25_000;

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
  /**
   * True when `html` is empty because the fragment could not be cleaned safely (too large to parse, did not settle,
   * failed the output grammar). Distinct from a fragment that cleaned to nothing: the renderer must not print it.
   */
  refused: boolean;
  /**
   * What the first cleaning round found OUTSIDE the paper's structure. Neither is a problem for a person (the text is
   * kept and `stripped` says so); an unattended caller can treat them as a reason to ask again.
   */
  structure: {
    /** Tags that are not HTML or SVG elements at all (a model's `<thinking>` or `<analysis>`), whose tag was removed and text kept. */
    foreignTags: string[];
    /** True when non-blank text sits directly in the fragment, outside every element (a sentence between two paragraphs). */
    looseText: boolean;
  };
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

const NO_STRUCTURE: SanitizedQuestionPaperBody['structure'] = { foreignTags: [], looseText: false };

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

/** Attribute names the profile can produce (the output verifier's allowlist). */
const ALLOWED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'class', 'lang', 'dir', 'style', 'data-math', 'data-display', 'data-figure-id', 'data-placeholder', 'alt',
  ...Object.keys(SVG_ATTRIBUTES),
  ...Object.values(HTML_ATTRIBUTES).flatMap((byName) => Object.keys(byName)),
]);
const OUTPUT_GRAMMAR = { tags: ALLOWED_TAGS, attributes: ALLOWED_ATTRIBUTE_NAMES };

type Pass = { html: string; report: StripReport; foreignTags: Set<string>; looseText: boolean };

/** One cleaning round: sanitize-html with the profile's policy, then the style elements cleaned as CSS. */
function cleanOnce(raw: string): Pass {
  const report = new StripReport();
  // Unguessable per call: a fragment cannot write this element to have its text treated as CSS.
  const marker = `qs${randomBytes(12).toString('hex')}`;
  let svgDepth = 0;
  const open: string[] = [];
  const foreignTags = new Set<string>();
  let looseText = false;

  const cleanAttributes = (tag: string, attributes: Record<string, string>): Record<string, string> => {
    const clean: Record<string, string> = {};
    const isSvg = tag === 'svg' || SVG_PARTS.has(tag);
    for (const [name, value] of Object.entries(attributes)) {
      const lower = name.toLowerCase();
      if (SILENT_ATTRIBUTES.test(lower)) continue;
      if (value.length > MAX_ATTRIBUTE_CHARS) {
        // Before any pattern runs over it: the longest legitimate value is SVG path data (20,000 characters).
        report.add(`The attribute "${lower}" on <${tag}> was longer than ${number(MAX_ATTRIBUTE_CHARS)} characters and was removed`);
        continue;
      }
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
        if (cleaned === null) {
          report.add('A figure id that is not an asat_ or qpf_ id was removed');
          continue;
        }
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
    // `style` itself is NOT allowed: sanitize-html writes the text of an allowed style element out verbatim (see the
    // header); the marker element stands in for it.
    allowedTags: [...[...ALLOWED_TAGS].filter((tag) => tag !== 'style'), ...DROP_WITH_CONTENT, marker],
    allowedAttributes: false,
    parseStyleAttributes: false,
    disallowedTagsMode: 'discard',
    // A bound on nesting: deeper elements are dropped (their text is kept).
    nestingLimit: 40,
    // `style` is deliberately absent (it is not allowed, so its text is escaped like any text); the marker is present so
    // that a marker nested too deep loses its CSS instead of printing it.
    nonTextTags: [marker, 'script', 'textarea', 'option', 'xmp', 'noscript', 'template', 'noembed', 'noframes', 'plaintext', 'title', 'head', 'select', 'datalist'],
    // The parser's own view of whether an element is inside an <svg> (where a style element is not allowed).
    onOpenTag: (name) => {
      open.push(name);
      if (name === 'svg') svgDepth += 1;
    },
    onCloseTag: () => {
      if (open.pop() === 'svg') svgDepth -= 1;
    },
    transformTags: {
      '*': (tagName, attribs) => {
        const tag = tagName.toLowerCase();
        if (tag === 'style') {
          if (svgDepth > 0) {
            report.add('A <style> inside an <svg> was removed (put the CSS in a <style> before the drawing, or use style attributes)');
            return { tagName: DROPPED_STYLE, attribs: {} };
          }
          return { tagName: marker, attribs: {} };
        }
        if (MOTION_TAGS.has(tag)) {
          report.add(`Animation or motion "<${tag}>" was removed (a paper is printed, nothing moves)`);
          return { tagName: tag, attribs: {} };
        }
        if (DROP_WITH_CONTENT.has(tag)) {
          if (tag !== DROPPED_STYLE) report.add(`<${tag}> was removed with its content`);
          return { tagName: tag, attribs: {} };
        }
        if (!ALLOWED_TAGS.has(tag)) {
          // A model often wraps a fragment in <html><body>: unwrapping them is not worth a finding.
          if (!UNWRAP_SILENTLY.has(tag)) report.add(`<${tag}> is not allowed; its tag was removed and its text kept`);
          if (!UNWRAP_SILENTLY.has(tag) && !STANDARD_ELEMENTS.has(tag)) foreignTags.add(tag);
          return { tagName: tag, attribs: {} };
        }
        return { tagName: tag, attribs: cleanAttributes(tag, attribs) };
      },
    },
    // `tag` is undefined for text directly in the fragment, outside every element.
    textFilter: (text, tag) => {
      if (tag === undefined && text.trim() !== '') looseText = true;
      return text;
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

  return { html: writeStyleElements(html, marker, report), report, foreignTags, looseText };
}

const STYLE_OPEN = '<style>';
const STYLE_CLOSE = '</style>';

/**
 * Replaces each marker element of sanitize-html's output with a plain
 * `<style>` holding its text cleaned as CSS. The marker's text was escaped by
 * sanitize-html like any text, so it is exactly `[^<]*`; a marker that holds
 * anything else (a malformed region) is dropped, and the CSS cleaner refuses
 * text with `<` or `&` in it on top of that.
 */
function writeStyleElements(html: string, marker: string, report: StripReport): string {
  const open = `<${marker}>`;
  const close = `</${marker}>`;
  let output = '';
  let index = 0;
  let styleChars = 0;
  for (;;) {
    const start = html.indexOf(open, index);
    if (start < 0) break;
    const textStart = start + open.length;
    const end = html.indexOf(close, textStart);
    output += html.slice(index, start);
    if (end < 0) {
      // Cannot happen with balanced output; whatever follows is kept as text and the verifier has the last word.
      index = textStart;
      continue;
    }
    const escaped = html.slice(textStart, end);
    index = end + close.length;
    if (escaped.includes('<')) {
      report.add('A <style> block containing markup was removed');
      continue;
    }
    const text = escaped.replace(/&(lt|gt|amp|quot);/g, (_, name: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"' })[name]!);
    styleChars += text.length;
    // Over twice the limit the rest is not even parsed; the caller reports the total as a problem.
    const css = styleChars > L.styleChars * 2 ? '' : cleanStyleSheet(text, report, (name) => ALLOWED_TAGS.has(name));
    // A style element with nothing left is dropped rather than kept empty.
    if (css !== '') output += `${STYLE_OPEN}${css}${STYLE_CLOSE}`;
  }
  return output + html.slice(index);
}

/** Stats and the data they come from, counted on the elements that are in the OUTPUT (never on what was dropped). */
function statsOf(elements: readonly ScannedElement[], styleTexts: readonly string[], inputChars: number): SanitizedQuestionPaperBody['stats'] {
  const stats = emptyStats(inputChars);
  const figureIds = new Set<string>();
  for (const { name, attributes } of elements) {
    stats.elements += 1;
    if (name === 'svg') stats.svgs += 1;
    if (SVG_PARTS.has(name)) stats.svgElements += 1;
    const math = attributes['data-math'];
    if (math !== undefined) {
      stats.mathNodes += 1;
      stats.longestMath = Math.max(stats.longestMath, math.length);
    }
    if (name === 'figure' && attributes['data-placeholder'] !== undefined) stats.placeholders += 1;
    const figureId = attributes['data-figure-id'];
    if (figureId !== undefined) figureIds.add(figureId);
  }
  stats.styleChars = styleTexts.reduce((sum, text) => sum + text.length, 0);
  stats.figureIds = [...figureIds];
  return stats;
}

/**
 * Cleans a model's HTML fragment with the `question_paper_body` profile. Pure
 * and synchronous; the input is never executed, fetched or evaluated.
 *
 * The cleaning is repeated until its output stops changing (at most
 * {@link MAX_ROUNDS} rounds), so cleaning the result again never changes it;
 * a fragment that does not settle, or whose result leaves the output grammar,
 * is refused with a problem and an empty `html`: nothing unverified leaves
 * this function. The stats count the final output only.
 */
export function sanitizeQuestionPaperBody(raw: string): SanitizedQuestionPaperBody {
  if (raw.length > L.parseChars) {
    return {
      html: '',
      stripped: [],
      problems: [`The paper is ${number(raw.length)} characters; the limit is ${number(L.fragmentChars)}. Make it shorter.`],
      refused: true,
      structure: NO_STRUCTURE,
      stats: emptyStats(raw.length),
    };
  }

  const first = cleanOnce(raw);
  let html = first.html;
  let settled = false;
  let scanned: ScannedOutput = { ok: false, reason: 'not scanned' };
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const next = cleanOnce(html);
    first.report.mergeNew(next.report);
    if (next.html !== html) {
      html = next.html;
      continue;
    }
    // Stable under cleaning. A string the grammar refuses cannot be saved; leave that to the refusal below.
    scanned = scanQuestionPaperOutput(html, OUTPUT_GRAMMAR);
    if (!scanned.ok) {
      settled = true;
      break;
    }
    // Stable and accepted: now the browser's tree builder must read it the way the grammar did (tree.ts). When it does
    // not, take the browser's own reading as the new text and clean it again; it settles in one or two more rounds.
    const tree = checkQuestionPaperTree(html, scanned.elements);
    if (tree.faithful) {
      settled = true;
      break;
    }
    // Moving or adding an element (an implied <tbody>, a list item pulled out of a div) loses nothing and is not reported;
    // an element the browser would not keep in that position (a stray <td>) is.
    for (const name of tree.dropped) first.report.add(`A <${name}> that cannot stand where it was written was removed`);
    html = tree.normalised;
  }

  const refused = (problem: string): SanitizedQuestionPaperBody => ({ html: '', stripped: first.report.lines(), problems: [problem], refused: true, structure: NO_STRUCTURE, stats: emptyStats(raw.length) });
  if (!settled) return refused('The paper could not be cleaned safely (its markup keeps changing when cleaned). Simplify the markup.');
  if (!scanned.ok) return refused(`The paper could not be cleaned safely (${scanned.reason}). Simplify the markup.`);

  const stats = statsOf(scanned.elements, scanned.styleTexts, raw.length);
  const problems: string[] = [];
  if (html.length > L.fragmentChars) problems.push(`The paper is ${number(html.length)} characters after cleaning; the limit is ${number(L.fragmentChars)}. Make it shorter.`);
  if (stats.elements > L.elements) problems.push(`The paper has ${number(stats.elements)} elements; the limit is ${number(L.elements)}. Simplify the markup.`);
  if (stats.svgs > L.svgs) problems.push(`The paper has ${stats.svgs} SVG drawings; the limit is ${L.svgs}.`);
  if (stats.svgElements > L.svgElements) problems.push(`The SVG drawings have ${number(stats.svgElements)} shapes in all; the limit is ${number(L.svgElements)}.`);
  if (stats.styleChars > L.styleChars) problems.push(`The <style> blocks are ${number(stats.styleChars)} characters; the limit is ${number(L.styleChars)}. Use fewer, shorter rules.`);
  if (stats.mathNodes > L.mathNodes) problems.push(`The paper has ${stats.mathNodes} formulas; the limit is ${L.mathNodes}.`);
  if (stats.longestMath > L.texChars) problems.push(`A formula is ${stats.longestMath} characters; the limit is ${L.texChars}. Split it.`);
  if (stats.figureIds.length + stats.placeholders > L.figures) problems.push(`The paper has ${stats.figureIds.length + stats.placeholders} figures and placeholders; the limit is ${L.figures}.`);

  return { html, stripped: first.report.lines(), problems, refused: false, structure: { foreignTags: [...first.foreignTags], looseText: first.looseText }, stats };
}
