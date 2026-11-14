import type { DatabaseExecutor } from '@campuspilot/db';
import { assistantConversationTable } from '@campuspilot/db/schema/assistant';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import type { PaperKey } from './question-paper.dto';

/**
 * The assistant conversations shared with a paper (`assistant_conversation`
 * with the paper's key, see docs/assistant.md "Conversations shared with a
 * question paper"), as the paper's procedures need them. Who may reach such a
 * conversation is the paper's class permission, which every caller here has
 * already checked for this paper.
 */

/** The paper key columns of a conversation equal to `key`, in the key's school. */
const sharedWith = (key: PaperKey) =>
  and(
    eq(assistantConversationTable.schoolId, key.schoolId),
    eq(assistantConversationTable.paperSessionId, key.sessionId),
    eq(assistantConversationTable.paperExamSlug, key.examSlug),
    eq(assistantConversationTable.paperClassId, key.classId),
    eq(assistantConversationTable.paperSubjectSlug, key.subjectSlug),
    eq(assistantConversationTable.paperModeSlug, key.modeSlug),
    isNull(assistantConversationTable.deletedAt),
  );

/** The paper's most recently active shared conversation, whoever started it; null when it has none. */
export async function latestPaperConversationId(db: DatabaseExecutor, key: PaperKey): Promise<string | null> {
  const [row] = await db
    .select({ id: assistantConversationTable.id })
    .from(assistantConversationTable)
    .where(sharedWith(key))
    .orderBy(desc(assistantConversationTable.updatedAt), desc(assistantConversationTable.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Whether a live conversation is one the paper's people share with `userId`
 * for this paper: their own (any conversation they started, as before
 * sharing), or one shared with exactly this paper. Draft ids and figure
 * images of a chat are read from such a conversation only.
 */
export async function isPaperChat(db: DatabaseExecutor, input: { conversationId: string; userId: string; key: PaperKey }): Promise<boolean> {
  const [row] = await db
    .select({ id: assistantConversationTable.id })
    .from(assistantConversationTable)
    .where(
      and(
        eq(assistantConversationTable.id, input.conversationId),
        or(
          and(eq(assistantConversationTable.schoolId, input.key.schoolId), eq(assistantConversationTable.userId, input.userId), isNull(assistantConversationTable.deletedAt)),
          sharedWith(input.key),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Whether a live conversation is shared with exactly this paper (`shareWithPaper`), whoever started it. */
export async function isSharedWithPaper(db: DatabaseExecutor, input: { conversationId: string; key: PaperKey }): Promise<boolean> {
  const [row] = await db
    .select({ id: assistantConversationTable.id })
    .from(assistantConversationTable)
    .where(and(eq(assistantConversationTable.id, input.conversationId), sharedWith(input.key)))
    .limit(1);
  return row !== undefined;
}
