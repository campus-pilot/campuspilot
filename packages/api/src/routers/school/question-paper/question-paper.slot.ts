import { rpcError } from "../../../errors";

/**
 * The body slot of the question paper document type.
 *
 * SECURITY, PLEASE READ BEFORE CHANGING (design.md A1/K1, acknowledged by the
 * product owner). Every other document is sanitised in full after rendering.
 * A question paper cannot be: its body carries KaTeX output, whose radicals
 * and arrows are inline `<svg>` that the document sanitiser strips, and whose
 * fonts need a `data:` font that the document CSP blocks. So the question
 * paper type, and only that type, has these two deliberate differences:
 *
 * 1. The body is NOT sanitised. It is built by our own renderer
 *    (`question-paper.render.ts`) from a validated JSON document: every
 *    string is HTML-escaped, the element and class vocabulary is fixed, no
 *    JSON value is ever markup, a URL, an attribute name, a class or CSS.
 *    That makes it trusted by construction. The school's template never sees
 *    it: the template is rendered with the constant {@link QUESTION_PAPER_SLOT}
 *    as `questionPaper.bodyHtml`, sanitised like any other document, and only
 *    then is the slot replaced by the body, exactly once
 *    ({@link substituteQuestionPaperBody}). Nothing a template author writes
 *    can therefore reach, repeat, enlarge or alter the body.
 * 2. The Content-Security-Policy of this type gains `font-src data:`
 *    (`document.render.ts`, `documentContentSecurityPolicy`). Nothing else is
 *    widened: still no network, no script, no frames, images from data URIs
 *    only. A `data:` font cannot load anything from outside the document.
 *
 * Do not extend this technique to another type, and do not add a second
 * trusted insertion point, without repeating that review.
 */
export const QUESTION_PAPER_SLOT = '<div class="qp-body" id="qp-body-slot"></div>';

/** Shown when a template does not place the body exactly once in element content. */
export const QUESTION_PAPER_SLOT_MESSAGE =
  "Place {{{questionPaper.bodyHtml}}} exactly once, in element content.";

/** How many times the slot appears in already sanitised HTML. */
export function countQuestionPaperSlots(sanitizedHtml: string): number {
  let count = 0;
  for (
    let at = sanitizedHtml.indexOf(QUESTION_PAPER_SLOT);
    at !== -1;
    at = sanitizedHtml.indexOf(QUESTION_PAPER_SLOT, at + QUESTION_PAPER_SLOT.length)
  ) {
    count += 1;
  }
  return count;
}

/**
 * Throws BAD_REQUEST unless the sanitised template output contains the slot
 * exactly once. Zero means the template escaped it (`{{...}}`), put it in an
 * attribute (the sanitiser escapes it there) or hid it in a false `{{#if}}`;
 * more than one means it sits in an `{{#each}}` or was written twice.
 */
export function assertSingleQuestionPaperSlot(sanitizedHtml: string): void {
  if (countQuestionPaperSlots(sanitizedHtml) !== 1) {
    throw rpcError.badRequest(QUESTION_PAPER_SLOT_MESSAGE);
  }
}

/**
 * Replaces the single slot of sanitised template output with the trusted
 * body. Done with `indexOf` and slicing, never `String.replace`, so `$&`,
 * `$1` or `$$` inside a question can never be interpreted as a replacement
 * pattern.
 */
export function substituteQuestionPaperBody(
  sanitizedHtml: string,
  bodyHtml: string,
): string {
  assertSingleQuestionPaperSlot(sanitizedHtml);
  const at = sanitizedHtml.indexOf(QUESTION_PAPER_SLOT);
  return (
    sanitizedHtml.slice(0, at) +
    bodyHtml +
    sanitizedHtml.slice(at + QUESTION_PAPER_SLOT.length)
  );
}
