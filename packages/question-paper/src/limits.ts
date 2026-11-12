/**
 * Every numeric bound of the HTML question paper, in one place so the
 * sanitiser, the validation, the renderer caps, the learn guide and the tests
 * all read the same numbers.
 *
 * These are product limits. The fragment is untrusted text (a model's output,
 * steered by photographs and prompts), so each limit also bounds the work the
 * server does on it.
 */
export const QUESTION_PAPER_LIMITS = {
  /**
   * UTF-16 characters of the stored fragment. A longer answer is refused, never cut.
   * 80,000 is deliberate: `getQuestionPaper` returns the fragment as JSON text (up to twice its
   * length) plus 40,000 for the rest, and the MCP layer allows at most 200,000 characters per
   * tool result, so every paper that can be saved can also be read back whole.
   */
  fragmentChars: 80_000,
  /**
   * The most characters the sanitiser will even parse. Between this and
   * `fragmentChars` the fragment is parsed so the finding can say how large it
   * is; beyond it the input is refused unread.
   * It is one and a half times `fragmentChars` (comments and removed tags are the only legitimate excess) and no more because the
   * parser's work grows faster than the input on unclosed nesting (`<svg><g>` repeated): measured worst cases are
   * about 100-150 ms at 120,000 characters but 5-18 s at the former 1,000,000, and the work blocks the event loop.
   */
  parseChars: 120_000,
  /** Elements of the fragment after sanitising (every tag counts, svg shapes too). */
  elements: 8_000,
  /** Inline `<svg>` drawings. */
  svgs: 40,
  /** Elements inside inline `<svg>` drawings, in total. */
  svgElements: 4_000,
  /** Characters of CSS in all `<style>` elements together (style attributes are bounded by `fragmentChars`). */
  styleChars: 30_000,
  /** LaTeX characters of one `data-math` expression. */
  texChars: 500,
  /** `data-math` expressions per paper. */
  mathNodes: 600,
  /** Uploaded figures plus placeholders. */
  figures: 30,
  /** Characters of a `data-placeholder` description. */
  placeholderChars: 500,
  /** Characters of an `alt` text. */
  altChars: 300,
  /**
   * Pages of the printed PDF. A longer paper is refused when it is printed (never cut): the sanitiser caps every
   * size, but many small allowed sizes can still add up, so the converter is held to this as well.
   */
  pdfPages: 40,
} as const;

export type QuestionPaperLimits = typeof QUESTION_PAPER_LIMITS;
