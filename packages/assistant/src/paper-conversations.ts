import { assistantPaperConversationSchema, type AssistantPaperConversationDto } from '@campuspilot/assistant-contract/dto';
import { assistantConversationTable } from '@campuspilot/db/schema/assistant';
import { user } from '@campuspilot/db/schema/auth';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

import type { AssistantExecutor } from './db';
import { hasRunIn, paperKeyWhere, toConversationDto, type PaperKeyParts } from './store';

/**
 * A question paper's chat history, for the router only: it names who started
 * each conversation from the account table, which the turn loop (and so
 * `store.ts`) must never import (see `runtime/boundary.test.ts`).
 */

/**
 * One page of the live conversations shared with a question paper, whoever
 * started them, newest first, each with its attention and its starter's
 * name. One statement per page, served by the paper index.
 */
export async function listPaperConversations(
  db: AssistantExecutor,
  input: { schoolId: string; paper: PaperKeyParts; page: number; pageSize: number },
): Promise<{ items: AssistantPaperConversationDto[]; totalItems: number }> {
  const where = and(
    eq(assistantConversationTable.schoolId, input.schoolId),
    paperKeyWhere(input.paper),
    isNull(assistantConversationTable.deletedAt),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        conversation: assistantConversationTable,
        startedByName: user.name,
        awaitingApproval: hasRunIn(['awaiting_approval']),
        working: hasRunIn(['queued', 'running']),
      })
      .from(assistantConversationTable)
      .leftJoin(user, eq(user.id, assistantConversationTable.userId))
      .where(where)
      .orderBy(desc(assistantConversationTable.updatedAt), desc(assistantConversationTable.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(assistantConversationTable).where(where),
  ]);
  return {
    items: rows.map((row) =>
      assistantPaperConversationSchema.parse({
        ...toConversationDto(row.conversation),
        attention: row.awaitingApproval ? 'approval' : row.working ? 'working' : null,
        startedByName: row.startedByName ?? null,
      }),
    ),
    totalItems: total?.value ?? 0,
  };
}
