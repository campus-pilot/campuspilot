import type {
  QuestionPaperQuestion,
  QuestionPaperShape,
} from "./schema";
import { formatPath, walkPaper, type Path } from "./walk";

export type WarningCode =
  | "total_differs_from_plan"
  | "total_differs_from_paper_header"
  | "question_without_marks"
  | "marks_mismatch_children"
  | "choice_unequal_marks"
  | "duplicate_question_number"
  | "figure_placeholder_unresolved"
  | "mcq_without_options"
  | "empty_section";

/**
 * A non-blocking finding. `path` points into the document using
 * `formatPath` notation (`sections[0].questions[2]`); an empty path means the
 * whole paper. Warnings are stored on the version and shown to the user and to
 * agents, and never block a save (D23).
 */
export type QuestionPaperWarning = {
  code: WarningCode;
  path: string;
  message: string;
};

export type PaperMarks = {
  /** Sum of the sections, see the rules in `computePaperMarks`. */
  total: number;
  sections: Array<{ index: number; total: number }>;
  /** Structural and marks warnings. No knowledge of the plan. */
  warnings: QuestionPaperWarning[];
};

/** Marks are multiples of 0.25, so arithmetic runs on integer quarter-marks and cannot drift. */
const toQuarters = (marks: number) => Math.round(marks * 4);
const fromQuarters = (quarters: number) => quarters / 4;
const formatMarks = (quarters: number) =>
  String(Number(fromQuarters(quarters).toFixed(2)));

type Counted = {
  marks?: number | null | undefined;
  parts?: Counted[] | undefined;
};

/**
 * Computes the marks of a document.
 *
 * 1. A node's own `marks` win. Without them it is the sum of its children's
 *    marks (a child without marks counts 0); with neither it is `null`. Own
 *    marks that differ from a non-null children sum warn
 *    `marks_mismatch_children`.
 * 2. A question with `alternatives` ("OR") counts its largest branch once.
 *    Branches with different non-null values warn `choice_unequal_marks`.
 * 3. A section with `attemptAny` k below its question count counts the k
 *    largest questions; unequal question values warn `choice_unequal_marks`.
 *    Without it every question counts.
 * 4. The paper total is the sum of its sections.
 */
export function computePaperMarks(paper: QuestionPaperShape): PaperMarks {
  const warnings: QuestionPaperWarning[] = [];
  const warn = (code: WarningCode, path: Path, message: string) =>
    warnings.push({ code, path: formatPath(path), message });

  /** Marks of a node in quarters, or null when nothing states them. */
  function nodeQuarters(node: Counted, path: Path): number | null {
    let childrenSum: number | null = null;
    node.parts?.forEach((child, i) => {
      const value = nodeQuarters(child, [...path, "parts", i]);
      if (value !== null) childrenSum = (childrenSum ?? 0) + value;
    });
    const own =
      typeof node.marks === "number" ? toQuarters(node.marks) : null;
    if (own !== null && childrenSum !== null && own !== childrenSum) {
      warn(
        "marks_mismatch_children",
        path,
        `Marks are ${formatMarks(own)} but the parts add up to ${formatMarks(childrenSum)}.`,
      );
    }
    if (own === null && childrenSum === null && !node.parts?.length) {
      warn(
        "question_without_marks",
        path,
        "No marks are stated for this question or part.",
      );
    }
    return own ?? childrenSum;
  }

  function questionQuarters(
    question: QuestionPaperQuestion,
    path: Path,
  ): number {
    const branches: Array<number | null> = [nodeQuarters(question, path)];
    question.alternatives?.forEach((alt, i) =>
      branches.push(nodeQuarters(alt, [...path, "alternatives", i])),
    );
    const stated = branches.filter((b): b is number => b !== null);
    if (new Set(stated).size > 1) {
      warn(
        "choice_unequal_marks",
        path,
        "The choices of this question carry different marks; the largest is counted.",
      );
    }
    return stated.length ? Math.max(...stated) : 0;
  }

  const sections = paper.sections.map((section, index) => {
    const sectionPath = ["sections", index] as const;
    if (section.questions.length === 0) {
      warn("empty_section", sectionPath, "This section has no questions.");
    }
    const values = section.questions.map((question, q) =>
      questionQuarters(question, [...sectionPath, "questions", q]),
    );
    const k = section.attemptAny;
    let total: number;
    if (k !== undefined && k < values.length) {
      if (new Set(values).size > 1) {
        warn(
          "choice_unequal_marks",
          sectionPath,
          `Only ${k} of ${values.length} questions are attempted but they carry different marks; the ${k} largest are counted.`,
        );
      }
      total = [...values]
        .sort((a, b) => b - a)
        .slice(0, k)
        .reduce((sum, v) => sum + v, 0);
    } else {
      total = values.reduce((sum, v) => sum + v, 0);
    }
    return { index, total };
  });
  const totalQuarters = sections.reduce((sum, s) => sum + s.total, 0);

  // Structural warnings independent of marks arithmetic.
  let placeholders = 0;
  walkPaper(paper, {
    block: (value) => {
      if (value.type === "figure_placeholder") placeholders += 1;
    },
    question: (question, path) => {
      if (question.type === "mcq" && !question.options?.length) {
        warn(
          "mcq_without_options",
          path,
          "This multiple choice question has no options.",
        );
      }
    },
  });
  paper.sections.forEach((section, index) => {
    const seen = new Set<string>();
    section.questions.forEach((question, q) => {
      if (seen.has(question.number)) {
        warn(
          "duplicate_question_number",
          ["sections", index, "questions", q, "number"],
          `Question number ${question.number} appears twice in this section.`,
        );
      }
      seen.add(question.number);
    });
  });
  if (placeholders > 0) {
    warn(
      "figure_placeholder_unresolved",
      [],
      `${placeholders} ${placeholders === 1 ? "figure still needs" : "figures still need"} an uploaded image.`,
    );
  }
  const header = paper.meta.maxMarks;
  if (typeof header === "number" && toQuarters(header) !== totalQuarters) {
    warn(
      "total_differs_from_paper_header",
      ["meta", "maxMarks"],
      `The paper header says ${formatMarks(toQuarters(header))} marks but the questions add up to ${formatMarks(totalQuarters)}.`,
    );
  }

  return {
    total: fromQuarters(totalQuarters),
    sections: sections.map((s) => ({ index: s.index, total: fromQuarters(s.total) })),
    warnings,
  };
}

/**
 * All warnings for a paper in a given exam plan: `computePaperMarks` plus
 * `total_differs_from_plan` when the plan's mode max marks are known and the
 * computed total differs (D23: warn only).
 */
export function paperWarnings(
  paper: QuestionPaperShape,
  ctx: { planMaxMarks: number | null },
): QuestionPaperWarning[] {
  const { total, warnings } = computePaperMarks(paper);
  if (ctx.planMaxMarks === null || toQuarters(ctx.planMaxMarks) === toQuarters(total)) {
    return warnings;
  }
  return [
    ...warnings,
    {
      code: "total_differs_from_plan",
      path: "",
      message: `The questions add up to ${formatMarks(toQuarters(total))} marks but this mode of the exam is out of ${ctx.planMaxMarks}.`,
    },
  ];
}
