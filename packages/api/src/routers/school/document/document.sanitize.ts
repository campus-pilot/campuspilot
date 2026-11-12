import sanitizeHtml from "sanitize-html";

/** The only image sources a document may carry (no SVG, no network). */
export const EMBEDDABLE_IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;

/**
 * The sanitiser options every document profile shares: only `data:` URLs
 * exist at all, protocol-relative URLs never do, and `style` elements are
 * accepted as raw text by sanitize-html (a profile that allows them is
 * responsible for cleaning that text itself).
 *
 * A profile is these options plus its own tag and attribute policy:
 * - `document` ({@link DOCUMENT_SANITIZER_OPTIONS}): every template render.
 * - `question_paper_body`
 *   (`question-paper/question-paper.sanitize.ts`): the HTML fragment a model
 *   writes for a question paper, which is stricter about attributes and CSS and
 *   additionally allows a safe subset of inline SVG.
 */
export const BASE_SANITIZER_OPTIONS = {
  allowedSchemes: ["data"],
  allowProtocolRelative: false,
  allowVulnerableTags: true,
} satisfies sanitizeHtml.IOptions;

/** The `document` profile: the options of every template render, unchanged from before profiles existed. */
export const DOCUMENT_SANITIZER_OPTIONS: sanitizeHtml.IOptions = {
  ...BASE_SANITIZER_OPTIONS,
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "html",
    "head",
    "body",
    "style",
    "img",
    "main",
    "header",
    "footer",
  ],
  allowedAttributes: {
    "*": ["class", "style", "id"],
    img: ["src", "alt", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
  },
  allowedSchemesByTag: { img: ["data"] },
  exclusiveFilter: (frame) =>
    frame.tag === "img" && !EMBEDDABLE_IMAGE.test(frame.attribs.src ?? ""),
};
