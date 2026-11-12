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
