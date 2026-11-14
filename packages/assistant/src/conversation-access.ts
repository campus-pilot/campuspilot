import { assertPermission, checkPermissions } from '@campuspilot/api/permissions/authorization';
import { CLASS_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';

import type { AssistantSession } from './session';
import { sharedPaperOf, type ConversationRow, type PaperKeyParts } from './store';

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
export async function mayReachConversation(session: AssistantSession, row: ConversationRow, need: ConversationNeed): Promise<boolean> {
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
