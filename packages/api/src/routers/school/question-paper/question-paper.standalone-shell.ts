/**
 * The built-in page a standalone question paper prints in
 * (docs/personal-space.md). A standalone paper has no school template: the AI
 * writes the whole paper, heading included, so this shell adds nothing of its
 * own (no logo, no school name, no footer text). It is a constant written
 * here, never stored, never editable and never a template revision.
 *
 * It goes through exactly the pipeline a school's template goes through
 * (`renderStandaloneQuestionPaperDocument` in `question-paper.render.ts`):
 * rendered with the constant slot as `questionPaper.bodyHtml`, sanitised as a
 * `question_paper` document under the same CSP, laid out on A4 by
 * `combineDocuments`, and only then is the slot replaced by the body, once.
 * The security notes of `question-paper.slot.ts` apply unchanged; this shell
 * adds no insertion point.
 */
export const STANDALONE_QUESTION_PAPER_SHELL = '<div class="qp-standalone">{{{questionPaper.bodyHtml}}}</div>';

/**
 * What this shell prints around the body: nothing, and that is known. The
 * `templatePrints` of a standalone paper, so the shared rules keep every line
 * of the source's heading (an exam paper's `null` would mean "not known").
 */
export const STANDALONE_QUESTION_PAPER_PRINTS = { above: [] as string[], below: [] as string[] };
