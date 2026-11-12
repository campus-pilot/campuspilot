import { z } from "zod";

import { crossChecks } from "./cross-checks";
import { QUESTION_PAPER_LIMITS as L } from "./limits";

/**
 * The structured question paper: the one document the AI job, the chat
 * agents, the API, the renderer and the UI all share (design.md section C).
 *
 * Rules that shape the schema:
 * - `.strict()` everywhere, so an agent's typo is an error with a path and
 *   never silently dropped.
 * - No pages, page breaks, columns or fonts (D35): layout belongs to the
 *   renderer and the school's template.
 * - Depth is explicit and bounded (question > part > subpart), never
 *   recursive: the providers' structured-output modes reject recursion.
 * - Every fact is its own field: `language`, `script` and `direction` are
 *   stated independently and never inferred from one another.
 * - Totals are computed (`marks.ts`), never stored in the document.
 */
export const QUESTION_PAPER_SCHEMA_VERSION = 1 as const;

/**
 * Writing systems the print pipeline has fonts for (verified in the
 * Gotenberg image, design.md A9). Its own field: never inferred from
 * `language`.
 */
export const SCRIPTS = [
  "latin",
  "devanagari",
  "bengali",
  "tamil",
  "telugu",
  "kannada",
  "malayalam",
  "gujarati",
  "gurmukhi",
  "oriya",
  "arabic",
] as const;
/**
 * `arabic` is the script of Urdu. Assamese uses `bengali`;
 * Marathi/Sanskrit/Nepali use `devanagari`.
 */
export const LANGUAGES = [
  "en",
  "hi",
  "mr",
  "sa",
  "ne",
  "bn",
  "as",
  "ta",
  "te",
  "kn",
  "ml",
  "gu",
  "pa",
  "or",
  "ur",
  "other",
] as const;
export const DIRECTIONS = ["ltr", "rtl"] as const;

/**
 * One styled stretch of text. `lang`/`script`/`dir` override the paper
 * default for this run only (an English term inside a Hindi sentence).
 */
const textRun = z
  .object({
    t: z.literal("text"),
    v: z.string().min(1).max(L.runChars),
    lang: z.enum(LANGUAGES).optional(),
    script: z.enum(SCRIPTS).optional(),
    dir: z.enum(DIRECTIONS).optional(),
    b: z.literal(true).optional(),
    i: z.literal(true).optional(),
    u: z.literal(true).optional(),
    sup: z.literal(true).optional(),
    sub: z.literal(true).optional(),
  })
  .strict();
/** LaTeX for KaTeX. No Unicode words inside: write words as text runs next to the math. */
const mathRun = z
  .object({
    t: z.literal("math"),
    tex: z.string().min(1).max(L.texChars),
    display: z.literal(true).optional(),
  })
  .strict();
const breakRun = z.object({ t: z.literal("br") }).strict();
const run = z.discriminatedUnion("t", [textRun, mathRun, breakRun]);
/** A bare string inside the array is a plain text run in the paper's language and script (saves tokens). */
const inline = z.union([z.string().min(1).max(L.runChars), run]);
/**
 * `"plain text"` or `["text ", {t:'math', tex:'x^2'}, " more"]`.
 * The 4,000 character total of one whole rich text is a cross check.
 */
export const richText = z.union([
  z.string().min(1).max(L.richChars),
  z.array(inline).min(1).max(L.runsPerText),
]);

/** null = not stated. Multiples of 0.25 up to 1000. */
const marks = z
  .number()
  .min(0)
  .max(L.maxMarksPerNode)
  .multipleOf(0.25)
  .nullable();

/** Stored content only ever holds `qpf_`; the `asat_` form is accepted on input and rewritten when saving. */
const imageId = z.string().regex(/^(qpf|asat)_[a-z0-9]{21}$/);
const figurePlaceholder = z
  .object({
    type: z.literal("figure_placeholder"),
    /** What the hand-drawn figure shows, so the teacher can supply the real image. */
    description: z.string().min(1).max(500),
    caption: richText.optional(),
    widthPct: z.number().int().min(20).max(100).optional(),
  })
  .strict();
const figure = z
  .object({
    type: z.literal("figure"),
    imageId,
    alt: z.string().min(1).max(300),
    caption: richText.optional(),
    widthPct: z.number().int().min(20).max(100).optional(),
  })
  .strict();
const table = z
  .object({
    type: z.literal("table"),
    /** The first row is a header row. */
    header: z.boolean().default(false),
    caption: richText.optional(),
    /** Every row must have the same width (cross check). */
    rows: z
      .array(z.array(richText).min(1).max(L.tableCols))
      .min(1)
      .max(L.tableRows),
  })
  .strict();
const paragraph = z
  .object({ type: z.literal("paragraph"), text: richText })
  .strict();
export const block = z.discriminatedUnion("type", [
  paragraph,
  figure,
  figurePlaceholder,
  table,
]);
const optionBlock = z.discriminatedUnion("type", [figure, figurePlaceholder]);

const option = z
  .object({
    /** "a", "(b)", "C", "3" exactly as written. */
    label: z.string().min(1).max(6),
    text: richText,
    blocks: z.array(optionBlock).max(2).optional(),
  })
  .strict();

const subPart = z
  .object({
    label: z.string().min(1).max(8),
    text: richText,
    marks,
    blocks: z.array(block).max(L.blocksPerNode).optional(),
    options: z.array(option).min(2).max(L.options).optional(),
  })
  .strict();
const part = subPart
  .extend({ parts: z.array(subPart).min(1).max(L.partsPerLevel).optional() })
  .strict();
/** The body of an "OR" branch: same content as a question but no number. */
const alternative = z
  .object({
    text: richText,
    marks: marks.optional(),
    blocks: z.array(block).max(L.blocksPerNode).optional(),
    options: z.array(option).min(2).max(L.options).optional(),
    parts: z.array(part).min(1).max(L.partsPerLevel).optional(),
  })
  .strict();

export const QUESTION_TYPES = [
  "mcq",
  "short_answer",
  "long_answer",
  "fill_blank",
  "true_false",
  "match",
  "numerical",
  "diagram",
  "other",
] as const;
const question = z
  .object({
    /** Printed verbatim: "1", "Q.2", "14(a)". */
    number: z.string().min(1).max(10),
    /** Semantic tag; layout comes from the content. */
    type: z.enum(QUESTION_TYPES),
    text: richText,
    marks,
    blocks: z.array(block).max(L.blocksPerNode).optional(),
    options: z.array(option).min(2).max(L.options).optional(),
    parts: z.array(part).min(1).max(L.partsPerLevel).optional(),
    /** "OR": the student answers this question or one of these. Marks count once (marks.ts). */
    alternatives: z.array(alternative).min(1).max(L.alternatives).optional(),
  })
  .strict();

const section = z
  .object({
    /** "Section A", "खंड अ". */
    heading: richText.optional(),
    instructions: z.array(richText).max(L.sectionInstructions).optional(),
    /** E.g. a reading passage. */
    blocks: z.array(block).max(L.blocksPerNode).optional(),
    /** "Attempt any k": only k of the questions need answering. */
    attemptAny: z.number().int().min(1).max(L.questionsPerSection).optional(),
    questions: z.array(question).min(1).max(L.questionsPerSection),
  })
  .strict();

/** The object without the cross checks, so `cross-checks.ts` can type its input. */
export const questionPaperShape = z
  .object({
    schemaVersion: z.literal(QUESTION_PAPER_SCHEMA_VERSION),
    /** Only when the paper prints its own title; the school header normally carries it. */
    title: richText.optional(),
    meta: z
      .object({
        language: z.enum(LANGUAGES),
        script: z.enum(SCRIPTS),
        direction: z.enum(DIRECTIONS),
        /** Hint read from the paper: "3 hours". Reaches the template as `questionPaper.timeAllowed`. */
        timeAllowed: z.string().max(40).optional(),
        /** Hint read from the paper header. Compared with the computed total, never authoritative. */
        maxMarks: z.number().min(0).max(1000).nullable().optional(),
        /** Hints only; the template uses the plan's names. */
        classLabel: z.string().max(60).optional(),
        subjectLabel: z.string().max(80).optional(),
        examLabel: z.string().max(100).optional(),
      })
      .strict(),
    generalInstructions: z
      .array(richText)
      .max(L.generalInstructions)
      .optional(),
    sections: z.array(section).min(1).max(L.sections),
  })
  .strict();

export const questionPaper = questionPaperShape.superRefine(crossChecks);

/** What a caller (the model, an agent, a test) writes; defaults not yet applied. */
export type QuestionPaperInput = z.input<typeof questionPaper>;
/** The normalized document: defaults applied, this is what is stored. */
export type QuestionPaper = z.output<typeof questionPaper>;
export type RichText = z.output<typeof richText>;
export type Block = z.output<typeof block>;
export type QuestionPaperQuestion = QuestionPaper["sections"][number]["questions"][number];
export type QuestionPaperSection = QuestionPaper["sections"][number];
export type Script = (typeof SCRIPTS)[number];
export type Language = (typeof LANGUAGES)[number];
/** The document before cross checks ran: the input type of `crossChecks`, `walkPaper` and the marks logic. */
export type QuestionPaperShape = z.output<typeof questionPaperShape>;
export type QuestionPaperOption = NonNullable<
  QuestionPaperQuestion["options"]
>[number];
