
import type { Context } from '../../../context';
import { rpcError, toRpcError } from '../../../errors';
import { o, protectedProcedure } from '../../../index';
import { checkPermissions } from '../../../permissions/authorization';
import { CLASS_ACTIONS, SCHOOL_ACTIONS } from '../../authorization/authorization.dto';
import { requireQuestionPaperAssistantAccess } from './question-paper.access';
import * as dto from './question-paper.school-list.dto';
import {
  examPaperClassIdsOf,
  listSchoolQuestionPaperFilterOptions,
  listSchoolQuestionPapers,
  type SchoolQuestionPaperAccess,
} from './question-paper.school-list';

const route = (summary: string, description: string) => ({ summary, description, tags: ['School', 'Question papers'] });

/** A screen read: on RPC and OpenAPI, never offered to MCP clients or the assistant (which use the per-kind paper tools). */
const screenRead = { mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'exams' } } as const;

/** The two school permissions the page is made of, decided in one OPA round with `oversee`. */
async function pagePermissionsOf(context: Context, schoolId: string, signal?: AbortSignal) {
  const resource = { kind: 'school', schoolId } as const;
  const [examPlans, quickPapers, oversee] = await checkPermissions(
    context,
    [
      { action: SCHOOL_ACTIONS.READ_EXAM_PLANS, resource },
      { action: SCHOOL_ACTIONS.READ_STANDALONE_PAPERS, resource },
      { action: SCHOOL_ACTIONS.OVERSEE_STANDALONE_PAPERS, resource },
    ],
    signal,
  );
  return { examPlans: examPlans === true, quickPapers: quickPapers === true, oversee: oversee === true };
}

/**
 * FORBIDDEN unless the caller may read at least one kind of paper the page
 * lists (`READ_EXAM_PLANS`, as an exam's Question paper tab, or
 * `READ_STANDALONE_PAPERS`). Before the assistant gate, so a caller without
 * either learns nothing about the school's features.
 */
const requireSomePaperPermission = o.middleware<Record<never, never>, { schoolId: string }>(async ({ context, next, signal }, input) => {
  const permissions = await pagePermissionsOf(context, input.schoolId, signal);
  if (!permissions.examPlans && !permissions.quickPapers) throw rpcError.forbidden();
  return next();
});

/**
 * What the caller sees on the page, each kind from its own grant: the exam
 * papers of the classes they may read (`class.exam.question_paper.read`,
 * checked for every class that has an exam paper in the session, in one OPA
 * round), and the quick papers they reach (their own, or every one with
 * `oversee`).
 */
async function pageAccessOf(context: Context, input: { schoolId: string; sessionId: string }, signal?: AbortSignal): Promise<SchoolQuestionPaperAccess> {
  const userId = context.session?.user.id;
  if (!userId) throw rpcError.unauthorized();
  const permissions = await pagePermissionsOf(context, input.schoolId, signal);
  let exam: SchoolQuestionPaperAccess['exam'] = null;
  if (permissions.examPlans) {
    const classIds = await examPaperClassIdsOf(context.db, input);
    const decisions = await checkPermissions(
      context,
      classIds.map((classId) => ({ action: CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS, resource: { kind: 'class' as const, schoolId: input.schoolId, classId } })),
      signal,
    );
    exam = { classIds: classIds.filter((_, index) => decisions[index] === true) };
  }
  return { exam, quick: permissions.quickPapers ? { userId, oversee: permissions.oversee } : null };
}

/**
 * The Question papers page of a real school (docs/question-papers.md "The
 * Question papers page"). Real schools only (the default school kind): a
 * personal space keeps its own papers page. Checked in order: a paper
 * permission (`requireSomePaperPermission`), the assistant gate (question
 * papers are part of the `assistant` feature, so the page exists only where
 * the school has AI and the caller's role may use it), then each kind of
 * paper on its own grant (`pageAccessOf`).
 */
export const schoolQuestionPaperListRouter = {
  listSchoolQuestionPapers: protectedProcedure
    .route(route('List the question papers of a session', "The Question papers page: a session's exam papers (of the classes you may read) and quick papers (yours, or every one when you oversee them), most recently changed first, with the names they show and their generation status. Without a status filter an exam paper is listed only once it has a version."))
    .meta(screenRead)
    .input(dto.listSchoolQuestionPapersInputSchema)
    .use(requireSomePaperPermission)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listSchoolQuestionPapersOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listSchoolQuestionPapers(context.db, input, await pageAccessOf(context, input, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listSchoolQuestionPaperFilterOptions: protectedProcedure
    .route(route('List the question paper filter values of a session', 'The distinct exam, class and subject names of the papers of the session you may see on the Question papers page, sorted.'))
    .meta(screenRead)
    .input(dto.listSchoolQuestionPaperFilterOptionsInputSchema)
    .use(requireSomePaperPermission)
    .use(requireQuestionPaperAssistantAccess())
    .output(dto.listSchoolQuestionPaperFilterOptionsOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listSchoolQuestionPaperFilterOptions(context.db, input, await pageAccessOf(context, input, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
