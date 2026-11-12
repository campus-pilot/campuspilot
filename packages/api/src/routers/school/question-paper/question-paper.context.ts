import type { DatabaseExecutor } from "@campuspilot/db";
import { schoolTable } from "@campuspilot/db/schema/school";
import type { QuestionPaper } from "@campuspilot/question-paper/schema";
import { eq } from "drizzle-orm";

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
    /** Marks computed from the paper's questions. */
    totalMarks: number | null;
    /** The "time allowed" hint read from the paper. */
    timeAllowed: string | null;
    language: string;
    script: string;
    direction: "ltr" | "rtl";
    /** Null for previews, drafts and the sample. */
    versionNo: number | null;
    /** Always the slot placeholder. Use `{{{questionPaper.bodyHtml}}}` exactly once. */
    bodyHtml: string;
  };
};

/**
 * The template context of one paper: the school block every document shares,
 * the exam, class, subject and mode names of the plan, and the facts of the
 * paper itself. `content` is null for the sample and for a paper without a
 * document yet; the plan's `maxMarks` is read from the scope, never from the
 * document. `generatedAt` is the instant of this render.
 */
export async function buildQuestionPaperContext(
  db: DatabaseExecutor,
  scope: PaperScope,
  paper: { content: QuestionPaper | null; versionNo: number | null; totalMarks: number | null },
  generatedAt: Date = new Date(),
): Promise<QuestionPaperContext> {
  const [school] = await db
    .select({ name: schoolTable.name, location: schoolTable.location, registrationNo: schoolTable.registrationNo, logoS3Key: schoolTable.logoS3Key })
    .from(schoolTable)
    .where(eq(schoolTable.id, scope.key.schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound("School");
  const meta = paper.content?.meta;
  return {
    school: await buildSchoolDocumentContext(school),
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
      totalMarks: paper.totalMarks,
      timeAllowed: meta?.timeAllowed ?? null,
      language: meta?.language ?? "en",
      script: meta?.script ?? "latin",
      direction: meta?.direction ?? "ltr",
      versionNo: paper.versionNo,
      bodyHtml: QUESTION_PAPER_SLOT,
    },
  };
}
