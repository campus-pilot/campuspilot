import { assertPermission, checkPermissions } from '@campuspilot/api/permissions/authorization';
import { rpcError } from '@campuspilot/api/errors';
import { CLASS_ACTIONS, SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { resolveStandalonePaper } from '@campuspilot/api/routers/school/question-paper/question-paper.scope';
import { ORPCError } from '@orpc/server';

import { db } from './db';
import type { AssistantSession } from './session';
import { sharedPaperOf, sharedStandalonePaperOf, type ConversationRow, type PaperKeyParts } from './store';

/**
 * What the caller wants to do with a conversation:
 * - `read`: see it and its live stream, approve or decline their own turn's
 *   changes, stop their own turn.
 * - `continue`: send into it, and stop a turn someone else started in it.
 */
export type ConversationNeed = 'read' | 'continue';

/** The class permission that a need asks for in a conversation shared with a paper. */
const PAPER_ACTION = {
  read: CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS,
  continue: CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS,
} as const;

/**
 * Whether the user may reach a live conversation of the school for `need`:
 * - A conversation shared with a question paper is reached through that
 *   paper's class permission, the same OPA check the paper's procedures
 *   make (reading the class's question papers to read it, managing them to
 *   continue it), for everyone, its starter included: a starter who loses the
 *   class no longer reads what colleagues write in it.
 * - A private conversation is its starter's only.
 * - Anything else is not reachable (the caller answers NOT_FOUND, so an id
 *   says nothing about whether it exists).
 *
 * Seeing the assistant in the school at all (`assertCanSee`) is checked by
 * the caller first, for every need; continuing also needs use access.
 */
/**
 * The school permission that a need asks for in a conversation shared with a
 * standalone paper (a personal space's paper, docs/personal-space.md, or a
 * school's quick paper, docs/question-papers.md "Quick papers in a school").
 */
const STANDALONE_PAPER_ACTION = {
  read: SCHOOL_ACTIONS.READ_STANDALONE_PAPERS,
  continue: SCHOOL_ACTIONS.MANAGE_STANDALONE_PAPERS,
} as const;

/**
 * Whether the user may `action` the standalone paper, in both kinds of school:
 * the school permission, and the paper must be one they reach (their own, or
 * any with `school.standalone_paper.oversee`), the rule the standalone paper
 * procedures apply (`resolveStandalonePaper`). Both permissions are decided in
 * one OPA round; a paper they do not reach (or that is gone) is a no.
 */
export async function mayReachStandalonePaper(
  session: AssistantSession,
  schoolId: string,
  paperId: string,
  action: (typeof STANDALONE_PAPER_ACTION)[ConversationNeed],
): Promise<boolean> {
  const resource = { kind: 'school', schoolId } as const;
  const [allowed, oversee] = await checkPermissions(session.context, [
    { action, resource },
    { action: SCHOOL_ACTIONS.OVERSEE_STANDALONE_PAPERS, resource },
  ]);
  if (allowed !== true) return false;
  try {
    await resolveStandalonePaper(db, { schoolId, paperId }, { userId: session.user.id, oversee: oversee === true });
    return true;
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'NOT_FOUND') return false;
    throw error;
  }
}

export async function mayReachConversation(session: AssistantSession, row: ConversationRow, need: ConversationNeed): Promise<boolean> {
  // A conversation shared with a standalone paper is reached as the paper is: its school permission for the need, on a
  // paper the user reaches. For everyone, its starter included, like an exam paper's.
  const standalonePaperId = sharedStandalonePaperOf(row);
  if (standalonePaperId !== null) return mayReachStandalonePaper(session, row.schoolId, standalonePaperId, STANDALONE_PAPER_ACTION[need]);
  const paper = sharedPaperOf(row);
  if (!paper) return row.userId === session.user.id;
  const [allowed] = await checkPermissions(session.context, [
    { action: PAPER_ACTION[need], resource: { kind: 'class', schoolId: row.schoolId, classId: paper.classId } },
  ]);
  return allowed === true;
}

/**
 * Throws FORBIDDEN unless the user may manage the paper's class: the right to
 * start a conversation shared with it, or to read its history.
 */
export async function assertMayManagePaper(session: AssistantSession, schoolId: string, paper: PaperKeyParts): Promise<void> {
  await assertPermission(session.context, {
    action: CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS,
    resource: { kind: 'class', schoolId, classId: paper.classId },
  });
}

/**
 * Throws FORBIDDEN unless the user may manage this standalone paper
 * ({@link mayReachStandalonePaper}): the right to start a conversation shared
 * with it, or to read its history.
 */
export async function assertMayManageStandalonePaper(session: AssistantSession, schoolId: string, paperId: string): Promise<void> {
  if (!(await mayReachStandalonePaper(session, schoolId, paperId, SCHOOL_ACTIONS.MANAGE_STANDALONE_PAPERS))) throw rpcError.forbidden();
}
