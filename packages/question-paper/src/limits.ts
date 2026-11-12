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
  /** UTF-16 characters of the stored fragment. A longer answer is refused, never cut. */
  fragmentChars: 200_000,
  /**
   * The most characters the sanitiser will even parse. Between this and
   * `fragmentChars` the fragment is parsed so the finding can say how large it
   * is; beyond it the input is refused unread.
   */
  parseChars: 1_000_000,
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
} as const;

export type QuestionPaperLimits = typeof QUESTION_PAPER_LIMITS;
