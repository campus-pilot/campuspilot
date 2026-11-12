import type { z } from "zod";

import { QUESTION_PAPER_LIMITS as L } from "./limits";
import type { QuestionPaperShape, RichText } from "./schema";
import { walkPaper, type Path } from "./walk";

/**
 * C0/C1-style control characters that never belong in printed text (tab,
 * line feed and carriage return are allowed). Built from a string so the
 * source file itself contains no control characters.
 */
const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]",
);

/** Characters a whole rich text spends against `QUESTION_PAPER_LIMITS.richChars`: text and math, runs of any kind. */
export function richTextChars(value: RichText): number {
  if (typeof value === "string") return value.length;
  let total = 0;
  for (const run of value) {
    if (typeof run === "string") total += run.length;
    else if (run.t === "text") total += run.v.length;
    else if (run.t === "math") total += run.tex.length;
  }
  return total;
}

/** Number of math runs inside one rich text. */
export function richTextMathNodes(value: RichText): number {
  if (typeof value === "string") return 0;
  return value.filter((run) => typeof run !== "string" && run.t === "math")
    .length;
}

function findControlChar(value: unknown, path: Path): Path | null {
  if (typeof value === "string") return CONTROL_CHARS.test(value) ? path : null;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const hit = findControlChar(item, [...path, i]);
      if (hit) return hit;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const hit = findControlChar(item, [...path, key]);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The checks a field-by-field schema cannot express. Every finding is an
 * error with a path, so a model can fix it. Everything else about a paper
 * (marks that do not add up, missing marks, unresolved figures) is a
 * warning in `marks.ts` and never blocks a save (D23).
 *
 * Math is additionally validated by KaTeX in the API (the KaTeX dependency
 * belongs to `packages/api` only, not to this dependency-free package).
 */
export function crossChecks(
  paper: QuestionPaperShape,
  ctx: z.RefinementCtx,
): void {
  const fail = (path: Path, message: string) =>
    ctx.addIssue({ code: "custom", path: [...path], message });

  // The one rule linking two stated facts. It rejects exactly one wrong
  // combination; it does not infer a script from a direction.
  if (paper.meta.direction === "rtl" && paper.meta.script !== "arabic") {
    fail(
      ["meta", "script"],
      "A right-to-left paper must use the arabic script (the script of Urdu).",
    );
  }

  const controlChar = findControlChar(paper, []);
  if (controlChar) {
    fail(controlChar, "Control characters are not allowed in text.");
  }

  let questions = 0;
  let mathNodes = 0;
  let tables = 0;
  let figures = 0;
  walkPaper(paper, {
    question: () => {
      questions += 1;
    },
    richText: (value, path) => {
      mathNodes += richTextMathNodes(value);
      if (richTextChars(value) > L.richChars) {
        fail(
          path,
          `This text is longer than ${L.richChars} characters. Split it into several paragraphs or questions.`,
        );
      }
    },
    block: (value, path) => {
      if (value.type === "table") {
        tables += 1;
        const width = value.rows[0]?.length ?? 0;
        value.rows.forEach((row, r) => {
          if (row.length !== width) {
            fail(
              [...path, "rows", r],
              `Every table row must have ${width} cells, like the first row.`,
            );
          }
        });
      } else if (value.type !== "paragraph") {
        figures += 1;
      }
    },
    options: (value, path) => {
      const seen = new Set<string>();
      value.forEach((option, i) => {
        if (seen.has(option.label)) {
          fail(
            [...path, i, "label"],
            `Option label "${option.label}" is used twice in the same question.`,
          );
        }
        seen.add(option.label);
      });
    },
  });

  if (questions > L.questionsPerPaper) {
    fail(["sections"], `A paper can have at most ${L.questionsPerPaper} questions.`);
  }
  if (mathNodes > L.mathNodesPerPaper) {
    fail(
      ["sections"],
      `A paper can have at most ${L.mathNodesPerPaper} math expressions.`,
    );
  }
  if (tables > L.tablesPerPaper) {
    fail(["sections"], `A paper can have at most ${L.tablesPerPaper} tables.`);
  }
  if (figures > L.figuresPerPaper) {
    fail(
      ["sections"],
      `A paper can have at most ${L.figuresPerPaper} figures (uploaded and placeholders together).`,
    );
  }
  if (JSON.stringify(paper).length > L.jsonChars) {
    fail([], `The whole paper is larger than ${L.jsonChars} characters.`);
  }
}
