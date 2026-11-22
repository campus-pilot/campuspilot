import type { DatabaseExecutor } from "@campuspilot/db";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import type { QuestionPaperPrintedDetails } from "@campuspilot/db/schema/exam-question-paper";
import { and, eq } from "drizzle-orm";

import { rpcError } from "../../../errors";
import { buildSchoolDocumentContext } from "../document/document.context";
import type { PaperScope } from "./question-paper.scope";
import { QUESTION_PAPER_SLOT } from "./question-paper.slot";

/**
 * The context a school's `question_paper` template is rendered with
 * (design.md D2). The same shape is used for real renders and for the
 * synthetic sample in `document.catalog.ts`.
 *
 * It holds school, session, exam and paper facts only: no student, staff,
 * finance or result data, and no teacher or author names in v1. The
 * questions are NOT part of the context: `questionPaper.bodyHtml` is the
 * constant slot placeholder (`QUESTION_PAPER_SLOT`) that the renderer
 * replaces with the printed questions after the template has been
 * sanitised.
 */
export type QuestionPaperContext = {
  school: {
    name: string;
    location: string | null;
    registrationNo: string | null;
    logoUrl: string | null;
  };
  session: { startYear: number; endYear: number };
  /** ISO timestamp. */
  generatedAt: string;
  exam: { name: string; slug: string; order: number };
  questionPaper: {
    className: string;
    subjectName: string;
    subjectSlug: string;
    /** The mode's name in the class configuration. */
    modeName: string;
    modeSlug: string;
    /** The plan's max marks for this mode, snapshotted at render. */
    maxMarks: number | null;
    /**
     * Always null. The paper is free HTML and nothing reads facts out of it
     * (marks, time allowed, language): these keys stay so that template
     * revisions written against the structured paper keep rendering, their
     * `{{#if}}` blocks simply print nothing.
     */
    totalMarks: null;
    /** Always null, see `totalMarks`. */
    timeAllowed: null;
    /** Always null, see `totalMarks`. The paper's text carries its own `lang`. */
    language: null;
    /** Always null, see `totalMarks`. */
    script: null;
    /**
     * The direction of the page frame around the paper, always `ltr`. The paper
     * itself sets `dir` on the elements that need it; nothing here is read from it.
     */
    direction: "ltr";
    /** Null for previews, drafts and the sample. */
    versionNo: number | null;
    /** Always the slot placeholder. Use `{{{questionPaper.bodyHtml}}}` exactly once. */
    bodyHtml: string;
  };
};

/**
 * The template context of one paper: the school block every document shares,
 * the exam, class, subject and mode names of the plan, and the version number.
 * The plan's `maxMarks` is read from the scope, never from the paper.
 * `generatedAt` is the instant of this render.
 */
export async function buildQuestionPaperContext(
  db: DatabaseExecutor,
  scope: PaperScope,
  paper: { versionNo: number | null },
  generatedAt: Date = new Date(),
): Promise<QuestionPaperContext> {
  return {
    school: await schoolBlockOf(db, scope.key.schoolId),
    session: { startYear: scope.sessionStartYear, endYear: scope.sessionEndYear },
    generatedAt: generatedAt.toISOString(),
    exam: { name: scope.examName, slug: scope.key.examSlug, order: scope.examOrder },
    questionPaper: {
      className: scope.className,
      subjectName: scope.subjectName,
      subjectSlug: scope.key.subjectSlug,
      modeName: scope.modeName,
      modeSlug: scope.key.modeSlug,
      maxMarks: scope.planMaxMarks,
      totalMarks: null,
      timeAllowed: null,
      language: null,
      script: null,
      direction: "ltr",
      versionNo: paper.versionNo,
      bodyHtml: QUESTION_PAPER_SLOT,
    },
  };
}

/** The school block every question paper context shares. */
async function schoolBlockOf(db: DatabaseExecutor, schoolId: string): Promise<QuestionPaperContext["school"]> {
  const [school] = await db
    .select({ name: schoolTable.name, location: schoolTable.location, registrationNo: schoolTable.registrationNo, logoS3Key: schoolTable.logoS3Key })
    .from(schoolTable)
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound("School");
  return buildSchoolDocumentContext(school);
}

/** The details of a quick paper its school's template prints: the shape a version keeps (`printed_details`). */
export type QuickPaperPrintedDetails = QuestionPaperPrintedDetails;

/**
 * The template context of a quick paper (a standalone paper of a real school
 * that prints with the school's template; docs/question-papers.md "Quick
 * papers in a school"). The same shape as an exam paper's, so every school
 * template renders it:
 *
 * - `school`: the school, as for every document.
 * - `session`: the session the paper belongs to (`exam_question_paper.session_id`).
 * - the exam name, class name, subject name and `maxMarks` come from the
 *   paper's details (the ones a save is about to store, when it states
 *   them); a detail the paper does not state is an empty name, or null marks.
 * - A quick paper has no exam slug, order, subject slug or mode: those are
 *   empty (`order` 0), never invented.
 */
export async function buildQuickPaperContext(
  db: DatabaseExecutor,
  input: { schoolId: string; sessionId: string; details: QuickPaperPrintedDetails; versionNo: number | null },
  generatedAt: Date = new Date(),
): Promise<QuestionPaperContext> {
  const [session] = await db
    .select({ startYear: schoolSessionTable.sessionStartYear, endYear: schoolSessionTable.sessionEndYear })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.id, input.sessionId), eq(schoolSessionTable.schoolId, input.schoolId)))
    .limit(1);
  if (!session) throw rpcError.notFound("Academic session");
  const { details } = input;
  return {
    school: await schoolBlockOf(db, input.schoolId),
    session: { startYear: session.startYear, endYear: session.endYear },
    generatedAt: generatedAt.toISOString(),
    exam: { name: details.examName ?? "", slug: "", order: 0 },
    questionPaper: {
      className: details.className ?? "",
      subjectName: details.subjectName ?? "",
      subjectSlug: "",
      modeName: "",
      modeSlug: "",
      maxMarks: details.maxMarks,
      totalMarks: null,
      timeAllowed: null,
      language: null,
      script: null,
      direction: "ltr",
      versionNo: input.versionNo,
      bodyHtml: QUESTION_PAPER_SLOT,
    },
  };
}

/**
 * A context as the template's printed lines are read for a quick paper
 * (`readTemplatePrints`), not for a print: the same shape, except that a
 * detail the paper does not state yet is shown by a placeholder in square
 * brackets ("[class]", "[maximum marks]") instead of an empty value. A
 * template that prints the maximum marks only when they are known
 * (`{{#if questionPaper.maxMarks}}`) would otherwise hide that line, and an
 * author who writes the paper's first version would print the marks again in
 * the body, under the line the template adds once the details are saved.
 */
export type QuestionPaperPrintsContext = Omit<QuestionPaperContext, "questionPaper"> & {
  questionPaper: Omit<QuestionPaperContext["questionPaper"], "maxMarks"> & { maxMarks: number | string | null };
};

/** The placeholders {@link withDetailPlaceholders} shows for details a quick paper does not state yet. */
export const QUICK_PAPER_DETAIL_PLACEHOLDERS = {
  className: "[class]",
  subjectName: "[subject]",
  examName: "[examination]",
  maxMarks: "[maximum marks]",
} as const;

/** A quick paper's context with {@link QUICK_PAPER_DETAIL_PLACEHOLDERS} for every detail it does not state ({@link QuestionPaperPrintsContext}). */
export function withDetailPlaceholders(context: QuestionPaperContext, details: QuickPaperPrintedDetails): QuestionPaperPrintsContext {
  return {
    ...context,
    exam: { ...context.exam, name: details.examName ?? QUICK_PAPER_DETAIL_PLACEHOLDERS.examName },
    questionPaper: {
      ...context.questionPaper,
      className: details.className ?? QUICK_PAPER_DETAIL_PLACEHOLDERS.className,
      subjectName: details.subjectName ?? QUICK_PAPER_DETAIL_PLACEHOLDERS.subjectName,
      maxMarks: details.maxMarks ?? QUICK_PAPER_DETAIL_PLACEHOLDERS.maxMarks,
    },
  };
}
