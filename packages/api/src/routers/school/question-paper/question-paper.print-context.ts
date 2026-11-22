import type { DatabaseExecutor } from '@campuspilot/db';

import { rpcError } from '../../../errors';
import {
  buildQuestionPaperContext,
  buildQuickPaperContext,
  withDetailPlaceholders,
  type QuestionPaperContext,
  type QuestionPaperPrintsContext,
  type QuickPaperPrintedDetails,
} from './question-paper.context';
import { findPaperOf } from './question-paper.records';
import { isStandalonePaper, printLayoutOf, type ResolvedPaper, type StandalonePaperScope } from './question-paper.scope';

/**
 * The template context of any paper that prints with its school's template
 * (docs/question-papers.md): an exam paper's plan facts
 * (`buildQuestionPaperContext`), or a quick paper's session and details
 * (`buildQuickPaperContext`). A `plain` paper has no template and no context:
 * asking for one is a programming error.
 *
 * - `planMaxMarks`: an exam paper's maximum to print (a stored version's own
 *   snapshot); omitted, the plan's as it is now. Not used for a quick paper.
 * - `details`: a quick paper's details to print, when the caller holds newer
 *   ones than the row (a save about to store them); omitted, the row's.
 */
export async function buildPaperContext(
  db: DatabaseExecutor,
  scope: ResolvedPaper,
  input: { versionNo: number | null; planMaxMarks?: number | null; details?: QuickPaperPrintedDetails },
  generatedAt: Date = new Date(),
): Promise<QuestionPaperContext> {
  if (!isStandalonePaper(scope)) {
    return buildQuestionPaperContext(db, { ...scope, planMaxMarks: input.planMaxMarks ?? scope.planMaxMarks }, { versionNo: input.versionNo }, generatedAt);
  }
  if (printLayoutOf(scope) !== 'school_template' || !scope.sessionId) throw new Error('A plain question paper prints without a template.');
  const details = input.details ?? (await quickPaperDetailsOf(db, scope));
  return buildQuickPaperContext(db, { schoolId: scope.schoolId, sessionId: scope.sessionId, details, versionNo: input.versionNo }, generatedAt);
}

/**
 * The context the lines a paper's template prints are read with
 * (`readTemplatePrints`): {@link buildPaperContext}, and for a quick paper with
 * a placeholder for each detail it does not state yet (`withDetailPlaceholders`),
 * so every line the template prints shows, with what fills it.
 */
export async function buildPaperPrintsContext(db: DatabaseExecutor, scope: ResolvedPaper, generatedAt: Date): Promise<QuestionPaperContext | QuestionPaperPrintsContext> {
  if (!isStandalonePaper(scope)) return buildPaperContext(db, scope, { versionNo: null }, generatedAt);
  const details = await quickPaperDetailsOf(db, scope);
  return withDetailPlaceholders(await buildPaperContext(db, scope, { versionNo: null, details }, generatedAt), details);
}

/** A quick paper's details as its row holds them now (NOT_FOUND when it was deleted meanwhile). */
async function quickPaperDetailsOf(db: DatabaseExecutor, scope: StandalonePaperScope): Promise<QuickPaperPrintedDetails> {
  const paper = await findPaperOf(db, scope);
  if (!paper) throw rpcError.notFound('Question paper');
  return { className: paper.detailsClassName, subjectName: paper.detailsSubjectName, examName: paper.detailsExamName, maxMarks: paper.detailsMaxMarks };
}
