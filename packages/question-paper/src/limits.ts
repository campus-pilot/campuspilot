/**
 * Every numeric bound of the structured question paper, in one place so the
 * Zod schema, the cross checks, the renderer caps, the learn guide and the
 * tests all read the same numbers.
 *
 * These are product limits, not provider limits: the provider-facing JSON
 * Schema drops numeric and length keywords (providers ignore or reject them),
 * so the Zod schema is the only authority and re-validates everything.
 */
export const QUESTION_PAPER_LIMITS = {
  sections: 20,
  questionsPerSection: 100,
  questionsPerPaper: 300,
  /** `question.parts` and `part.parts`. */
  partsPerLevel: 20,
  alternatives: 3,
  options: 8,
  blocksPerNode: 10,
  /** Runs (strings, text, math, br) in one rich text array. */
  runsPerText: 60,
  runChars: 2_000,
  /** Sum of the text and math characters of one whole rich text. */
  richChars: 4_000,
  /** LaTeX characters of one math run. */
  texChars: 500,
  mathNodesPerPaper: 600,
  tablesPerPaper: 12,
  tableRows: 20,
  tableCols: 10,
  /** Uploaded figures plus placeholders. */
  figuresPerPaper: 30,
  generalInstructions: 20,
  sectionInstructions: 10,
  /** Marks are 0..maxMarksPerNode in multiples of 0.25. */
  maxMarksPerNode: 1_000,
  /** Serialized JSON of the whole document. */
  jsonChars: 200_000,
} as const;

export type QuestionPaperLimits = typeof QUESTION_PAPER_LIMITS;
