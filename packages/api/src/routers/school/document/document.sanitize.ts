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

/**
 * The `document` profile for HTML converted to PDF with generated image
 * assets (`asset-<sha256>.<ext>`, see `document.images.ts`). The only change
 * is which `<img src>` survives: a raster `data:` URI as always, or one of
 * `assets`, the names generated for the batch being converted, matched
 * exactly. Any other relative path, `http(s):` or `file:` URL is removed
 * with its element, as before. Without assets this is
 * {@link DOCUMENT_SANITIZER_OPTIONS} itself.
 */
export function documentSanitizerOptions(
  assets?: ReadonlySet<string>,
): sanitizeHtml.IOptions {
  if (!assets || assets.size === 0) return DOCUMENT_SANITIZER_OPTIONS;
  return {
    ...DOCUMENT_SANITIZER_OPTIONS,
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const src = frame.attribs.src ?? "";
      return !(EMBEDDABLE_IMAGE.test(src) || assets.has(src));
    },
  };
}
