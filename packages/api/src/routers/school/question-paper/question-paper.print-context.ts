import type { DatabaseExecutor } from '@campuspilot/db';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import {
  buildQuestionPaperContext,
  buildQuickPaperContext,
  withDetailPlaceholders,
  type QuestionPaperContext,
  type QuestionPaperPrintsContext,
  type QuickPaperNamedDetails,
  type QuickPaperPrintedDetails,
} from './question-paper.context';
import { findPaperOf } from './question-paper.records';
import { isStandalonePaper, printLayoutOf, type ResolvedPaper, type StandalonePaperScope } from './question-paper.scope';

/**
 * The template context of any paper that prints with its school's template
 * (docs/question-papers.md): an exam paper's plan facts
 * (`buildQuestionPaperContext`), or a quick paper's printed details
 * (`buildQuickPaperContext`). A `plain` paper has no template and no context:
 * asking for one is a programming error.
 *
 * - `planMaxMarks`: an exam paper's maximum to print (a stored version's own
 *   snapshot); omitted, the plan's as it is now. Not used for a quick paper.
 * - `printed`: a quick paper's heading to print, when the caller holds it (a
 *   save about to store it, a stored version's snapshot); omitted, the
 *   paper's details now with the school's active session
 *   ({@link currentQuickPaperPrintedDetails}).
 */
export async function buildPaperContext(
  db: DatabaseExecutor,
  scope: ResolvedPaper,
  input: { versionNo: number | null; planMaxMarks?: number | null; printed?: QuickPaperPrintedDetails },
  generatedAt: Date = new Date(),
): Promise<QuestionPaperContext> {
  if (!isStandalonePaper(scope)) {
    return buildQuestionPaperContext(db, { ...scope, planMaxMarks: input.planMaxMarks ?? scope.planMaxMarks }, { versionNo: input.versionNo }, generatedAt);
  }
  if (printLayoutOf(scope) !== 'school_template') throw new Error('A plain question paper prints without a template.');
  const printed = input.printed ?? (await currentQuickPaperPrintedDetails(db, scope));
  return buildQuickPaperContext(db, { schoolId: scope.schoolId, printed, versionNo: input.versionNo }, generatedAt);
}

/**
 * The context the lines a paper's template prints are read with
 * (`readTemplatePrints`): {@link buildPaperContext}, and for a quick paper with
 * a placeholder for each detail it does not state yet (`withDetailPlaceholders`),
 * so every line the template prints shows, with what fills it.
 */
export async function buildPaperPrintsContext(db: DatabaseExecutor, scope: ResolvedPaper, generatedAt: Date): Promise<QuestionPaperContext | QuestionPaperPrintsContext> {
  if (!isStandalonePaper(scope)) return buildPaperContext(db, scope, { versionNo: null }, generatedAt);
  const printed = await currentQuickPaperPrintedDetails(db, scope);
  return withDetailPlaceholders(await buildPaperContext(db, scope, { versionNo: null, printed }, generatedAt), printed);
}

/** `data.reason` of the refusal to print a quick paper while its school has no active academic session. */
export const QUICK_PAPER_NO_ACTIVE_SESSION_REASON = 'quick_paper_no_active_session';

/** Whether an error is the refusal of {@link currentQuickPaperPrintedDetails} for a school without an active session. */
export const isQuickPaperNoActiveSessionError = (error: unknown): boolean =>
  error instanceof ORPCError && (error.data as { reason?: unknown } | undefined)?.reason === QUICK_PAPER_NO_ACTIVE_SESSION_REASON;

/**
 * What a quick paper's heading prints now: the names and marks a save states
 * (`stated`), or the paper's stored details; and the years of the school's
 * active academic session. A quick paper belongs to no session, so a print
 * takes the session the school is in when it is printed, and a saved version
 * keeps it (`printed_details`). A school without an active session cannot
 * print one: BAD_REQUEST (`QUICK_PAPER_NO_ACTIVE_SESSION_REASON`), before any
 * model cost when a generation starts.
 */
export async function currentQuickPaperPrintedDetails(
  db: DatabaseExecutor,
  scope: StandalonePaperScope,
  stated?: QuickPaperNamedDetails,
): Promise<QuickPaperPrintedDetails> {
  const names = stated ?? (await quickPaperNamesOf(db, scope));
  const [session] = await db
    .select({ startYear: schoolSessionTable.sessionStartYear, endYear: schoolSessionTable.sessionEndYear })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.schoolId, scope.schoolId), eq(schoolSessionTable.isActive, true)))
    .limit(1);
  if (!session) {
    throw new ORPCError('BAD_REQUEST', {
      message: "Activate an academic session first: the school's question paper template prints its years.",
      data: { reason: QUICK_PAPER_NO_ACTIVE_SESSION_REASON },
    });
  }
  return {
    className: names.className,
    subjectName: names.subjectName,
    examName: names.examName,
    maxMarks: names.maxMarks,
    sessionStartYear: session.startYear,
    sessionEndYear: session.endYear,
  };
}

/** A quick paper's details as its row holds them now (NOT_FOUND when it was deleted meanwhile). */
async function quickPaperNamesOf(db: DatabaseExecutor, scope: StandalonePaperScope): Promise<QuickPaperNamedDetails> {
  const paper = await findPaperOf(db, scope);
  if (!paper) throw rpcError.notFound('Question paper');
  return { className: paper.detailsClassName, subjectName: paper.detailsSubjectName, examName: paper.detailsExamName, maxMarks: paper.detailsMaxMarks };
}
