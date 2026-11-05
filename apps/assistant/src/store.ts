import { and, asc, eq, sql } from 'drizzle-orm';

import {
  assistantConversationSchema,
  assistantItemSchema,
  assistantRunSchema,
  type AssistantConversationDto,
  type AssistantItemDto,
  type AssistantRunDto,
  type AssistantRunStatus,
  type AssistantStreamEvent,
  type AssistantSurface,
} from '@campuspilot/assistant-contract/dto';

import type { AssistantDatabase, AssistantExecutor } from './db/client';
import {
  assistantApprovalTable,
  assistantConversationTable,
  assistantItemTable,
  assistantRunTable,
  assistantTranscriptEntryTable,
  type AssistantItemBody,
} from './db/schema';
import { publishAssistantEvent } from './events';
import { log } from './log';

type ConversationRow = typeof assistantConversationTable.$inferSelect;
type RunRow = typeof assistantRunTable.$inferSelect;
type ItemRow = typeof assistantItemTable.$inferSelect;

export type AssistantChange = Exclude<AssistantStreamEvent, { type: 'snapshot' | 'text' }>;
/** Records a change to publish once the surrounding transaction commits. */
export type EmitAssistantChange = (conversationId: string, change: AssistantChange) => void;

export function toConversationDto(row: ConversationRow): AssistantConversationDto {
  return assistantConversationSchema.parse(row);
}

export function toRunDto(row: RunRow): AssistantRunDto {
  return assistantRunSchema.parse(row);
}

export function toItemDto(row: ItemRow): AssistantItemDto {
  return assistantItemSchema.parse(row);
}

/**
 * Runs assistant writes in one transaction and publishes their events only
 * after it commits, so a subscriber never sees a change that was rolled back.
 * A failed publish is logged, not thrown: the change is already durable and
 * the next snapshot will carry it.
 */
export async function assistantTransaction<T>(
  db: AssistantDatabase,
  work: (tx: AssistantExecutor, emit: EmitAssistantChange) => Promise<T>,
): Promise<T> {
  const pending: Array<[string, AssistantChange]> = [];
  const result = await db.transaction((tx) =>
    work(tx, (conversationId, change) => pending.push([conversationId, change])),
  );
  for (const [conversationId, change] of pending) {
    try {
      await publishAssistantEvent(conversationId, change);
    } catch (err) {
      log.warn({ err, conversationId, type: change.type }, 'assistant.publish.failed');
    }
  }
  return result;
}

type Allocation = {
  /** Reserve the next change sequence. */
  sequence?: boolean;
  /** Reserve the next item display position. */
  position?: boolean;
  /** Reserve the next transcript position. */
  transcript?: boolean;
};

/**
 * Reserves counters on the conversation row. The row lock this update takes
 * also serializes concurrent writers of one conversation, so sequences are
 * gap-tolerant but strictly increasing in commit order.
 */
async function allocate(
  tx: AssistantExecutor,
  conversationId: string,
  { sequence = false, position = false, transcript = false }: Allocation,
) {
  const [row] = await tx
    .update(assistantConversationTable)
    .set({
      lastSequence: sql`${assistantConversationTable.lastSequence} + ${sequence ? 1 : 0}`,
      lastPosition: sql`${assistantConversationTable.lastPosition} + ${position ? 1 : 0}`,
      lastTranscriptPosition: sql`${assistantConversationTable.lastTranscriptPosition} + ${transcript ? 1 : 0}`,
      updatedAt: new Date(),
    })
    .where(eq(assistantConversationTable.id, conversationId))
    .returning();
  if (!row) throw new Error(`Assistant conversation ${conversationId} does not exist.`);
  return row;
}

export async function createConversation(
  tx: AssistantExecutor,
  input: {
    id: string;
    schoolId: string;
    userId: string;
    title: string | null;
    provider: ConversationRow['provider'];
    model: string;
  },
): Promise<ConversationRow> {
  const [row] = await tx.insert(assistantConversationTable).values(input).returning();
  return row!;
}

/** A conversation the user owns in that school, or null. */
export async function findOwnedConversation(
  db: AssistantExecutor,
  input: { conversationId: string; schoolId: string; userId: string },
): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(assistantConversationTable)
    .where(
      and(
        eq(assistantConversationTable.id, input.conversationId),
        eq(assistantConversationTable.schoolId, input.schoolId),
        eq(assistantConversationTable.userId, input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findConversation(
  db: AssistantExecutor,
  conversationId: string,
): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(assistantConversationTable)
    .where(eq(assistantConversationTable.id, conversationId))
    .limit(1);
  return row ?? null;
}

export async function insertRun(
  tx: AssistantExecutor,
  emit: EmitAssistantChange,
  input: {
    id: string;
    conversationId: string;
    schoolId: string;
    userId: string;
    clientRequestId: string;
    surface: AssistantSurface;
  },
): Promise<AssistantRunDto> {
  const counters = await allocate(tx, input.conversationId, { sequence: true });
  const [row] = await tx
    .insert(assistantRunTable)
    .values({ ...input, sequence: counters.lastSequence })
    .returning();
  const run = toRunDto(row!);
  emit(input.conversationId, { type: 'run', run });
  return run;
}

export async function findRun(db: AssistantExecutor, runId: string): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(assistantRunTable)
    .where(eq(assistantRunTable.id, runId))
    .limit(1);
  return row ?? null;
}

export async function findRunByClientRequest(
  db: AssistantExecutor,
  input: { userId: string; clientRequestId: string },
): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(assistantRunTable)
    .where(
      and(
        eq(assistantRunTable.userId, input.userId),
        eq(assistantRunTable.clientRequestId, input.clientRequestId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type AssistantRunPatch = Partial<{
  status: AssistantRunStatus;
  provider: RunRow['provider'];
  model: string;
  stopRequestedAt: Date;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date;
}>;

export type AssistantUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export async function updateRun(
  tx: AssistantExecutor,
  emit: EmitAssistantChange,
  run: { id: string; conversationId: string },
  patch: AssistantRunPatch,
  usage?: AssistantUsage,
): Promise<AssistantRunDto> {
  const counters = await allocate(tx, run.conversationId, { sequence: true });
  const [row] = await tx
    .update(assistantRunTable)
    .set({
      ...patch,
      ...(usage
        ? {
            modelRequestCount: sql`${assistantRunTable.modelRequestCount} + 1`,
            inputTokens: sql`${assistantRunTable.inputTokens} + ${usage.inputTokens}`,
            outputTokens: sql`${assistantRunTable.outputTokens} + ${usage.outputTokens}`,
            cacheReadInputTokens: sql`${assistantRunTable.cacheReadInputTokens} + ${usage.cacheReadInputTokens}`,
            cacheCreationInputTokens: sql`${assistantRunTable.cacheCreationInputTokens} + ${usage.cacheCreationInputTokens}`,
          }
        : {}),
      sequence: counters.lastSequence,
    })
    .where(eq(assistantRunTable.id, run.id))
    .returning();
  const dto = toRunDto(row!);
  emit(run.conversationId, { type: 'run', run: dto });
  return dto;
}

export async function findItemByKey(
  db: AssistantExecutor,
  conversationId: string,
  itemKey: string,
): Promise<ItemRow | null> {
  const [row] = await db
    .select()
    .from(assistantItemTable)
    .where(
      and(
        eq(assistantItemTable.conversationId, conversationId),
        eq(assistantItemTable.itemKey, itemKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Inserts an item once per `itemKey`. A retried Restate step that already
 * created its item gets the existing one back, unchanged and unpublished.
 */
export async function insertItem(
  tx: AssistantExecutor,
  emit: EmitAssistantChange,
  input: {
    conversationId: string;
    runId: string;
    kind: ItemRow['kind'];
    status: ItemRow['status'];
    body: AssistantItemBody;
    itemKey: string;
  },
): Promise<AssistantItemDto> {
  const existing = await findItemByKey(tx, input.conversationId, input.itemKey);
  if (existing) return toItemDto(existing);

  const counters = await allocate(tx, input.conversationId, {
    sequence: true,
    position: true,
  });
  const [row] = await tx
    .insert(assistantItemTable)
    .values({
      ...input,
      position: counters.lastPosition,
      sequence: counters.lastSequence,
    })
    .returning();
  const item = toItemDto(row!);
  emit(input.conversationId, { type: 'item', item });
  return item;
}

export async function updateItem(
  tx: AssistantExecutor,
  emit: EmitAssistantChange,
  item: { id: string; conversationId: string },
  patch: { status?: ItemRow['status']; body?: AssistantItemBody },
): Promise<AssistantItemDto> {
  const counters = await allocate(tx, item.conversationId, { sequence: true });
  const [row] = await tx
    .update(assistantItemTable)
    .set({ ...patch, sequence: counters.lastSequence, updatedAt: new Date() })
    .where(eq(assistantItemTable.id, item.id))
    .returning();
  const dto = toItemDto(row!);
  emit(item.conversationId, { type: 'item', item: dto });
  return dto;
}

export async function findItem(db: AssistantExecutor, itemId: string): Promise<ItemRow | null> {
  const [row] = await db
    .select()
    .from(assistantItemTable)
    .where(eq(assistantItemTable.id, itemId))
    .limit(1);
  return row ?? null;
}

/**
 * Appends one model message to the transcript once per
 * `entryKey`; returns false when the entry already existed.
 */
export async function appendTranscriptEntry(
  tx: AssistantExecutor,
  input: {
    conversationId: string;
    runId: string;
    role: 'user' | 'assistant';
    content: unknown[];
    entryKey: string;
  },
): Promise<boolean> {
  const [existing] = await tx
    .select({ position: assistantTranscriptEntryTable.position })
    .from(assistantTranscriptEntryTable)
    .where(
      and(
        eq(assistantTranscriptEntryTable.conversationId, input.conversationId),
        eq(assistantTranscriptEntryTable.entryKey, input.entryKey),
      ),
    )
    .limit(1);
  if (existing) return false;

  const counters = await allocate(tx, input.conversationId, { transcript: true });
  await tx.insert(assistantTranscriptEntryTable).values({
    ...input,
    position: counters.lastTranscriptPosition,
  });
  return true;
}

export async function loadTranscript(
  db: AssistantExecutor,
  conversationId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: unknown[] }>> {
  return db
    .select({
      role: assistantTranscriptEntryTable.role,
      content: assistantTranscriptEntryTable.content,
    })
    .from(assistantTranscriptEntryTable)
    .where(eq(assistantTranscriptEntryTable.conversationId, conversationId))
    .orderBy(asc(assistantTranscriptEntryTable.position));
}

export type AssistantSnapshot = {
  conversation: AssistantConversationDto;
  items: AssistantItemDto[];
  runs: AssistantRunDto[];
};

/** The full visible state of a conversation, read in one transaction. */
export async function loadSnapshot(
  db: AssistantDatabase,
  conversationId: string,
): Promise<AssistantSnapshot | null> {
  return db.transaction(async (tx) => {
    const conversation = await findConversation(tx, conversationId);
    if (!conversation) return null;
    const [items, runs] = await Promise.all([
      tx
        .select()
        .from(assistantItemTable)
        .where(eq(assistantItemTable.conversationId, conversationId))
        .orderBy(asc(assistantItemTable.position)),
      tx
        .select()
        .from(assistantRunTable)
        .where(eq(assistantRunTable.conversationId, conversationId))
        .orderBy(asc(assistantRunTable.createdAt), asc(assistantRunTable.id)),
    ]);
    return {
      conversation: toConversationDto(conversation),
      items: items.map(toItemDto),
      runs: runs.map(toRunDto),
    };
  });
}

export type ApprovalRow = typeof assistantApprovalTable.$inferSelect;

export async function findApproval(
  db: AssistantExecutor,
  approvalId: string,
): Promise<ApprovalRow | null> {
  const [row] = await db
    .select()
    .from(assistantApprovalTable)
    .where(eq(assistantApprovalTable.id, approvalId))
    .limit(1);
  return row ?? null;
}

export async function findPendingApprovalForRun(
  db: AssistantExecutor,
  runId: string,
): Promise<ApprovalRow | null> {
  const [row] = await db
    .select()
    .from(assistantApprovalTable)
    .where(
      and(
        eq(assistantApprovalTable.runId, runId),
        eq(assistantApprovalTable.status, 'pending'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Moves a pending approval to its decision. Returns null when it was no
 * longer pending, so concurrent decisions cannot both win.
 */
export async function decideApproval(
  db: AssistantExecutor,
  approvalId: string,
  status: 'approved' | 'declined' | 'cancelled',
): Promise<ApprovalRow | null> {
  const [row] = await db
    .update(assistantApprovalTable)
    .set({ status, decidedAt: new Date() })
    .where(
      and(
        eq(assistantApprovalTable.id, approvalId),
        eq(assistantApprovalTable.status, 'pending'),
      ),
    )
    .returning();
  return row ?? null;
}

/** Puts a decided approval back to pending after its resume failed. */
export async function reopenApproval(db: AssistantExecutor, approvalId: string) {
  await db
    .update(assistantApprovalTable)
    .set({ status: 'pending', decidedAt: null })
    .where(eq(assistantApprovalTable.id, approvalId));
}

export async function setConversationTitle(
  tx: AssistantExecutor,
  emit: EmitAssistantChange,
  conversationId: string,
  title: string,
): Promise<void> {
  const [row] = await tx
    .update(assistantConversationTable)
    .set({ title, updatedAt: new Date() })
    .where(eq(assistantConversationTable.id, conversationId))
    .returning();
  if (row) emit(conversationId, { type: 'conversation', conversation: toConversationDto(row) });
}

export async function findTranscriptEntry(
  db: AssistantExecutor,
  conversationId: string,
  entryKey: string,
): Promise<{ content: unknown[] } | null> {
  const [row] = await db
    .select({ content: assistantTranscriptEntryTable.content })
    .from(assistantTranscriptEntryTable)
    .where(
      and(
        eq(assistantTranscriptEntryTable.conversationId, conversationId),
        eq(assistantTranscriptEntryTable.entryKey, entryKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Creates the approval for a tool call once; a retry returns the first one. */
export async function insertApproval(
  tx: AssistantExecutor,
  input: {
    conversationId: string;
    runId: string;
    itemId: string;
    schoolId: string;
    userId: string;
    toolName: string;
    awakeableId: string;
  },
): Promise<ApprovalRow> {
  const [existing] = await tx
    .select()
    .from(assistantApprovalTable)
    .where(eq(assistantApprovalTable.itemId, input.itemId))
    .limit(1);
  if (existing) return existing;
  const [row] = await tx.insert(assistantApprovalTable).values(input).returning();
  return row!;
}

/**
 * Marks a run's still-streaming messages complete with the text they have,
 * so an ended run never leaves a message that looks like it is typing.
 */
export async function completeStreamingItems(
  tx: AssistantExecutor,
  emit: EmitAssistantChange,
  run: { id: string; conversationId: string },
): Promise<void> {
  const rows = await tx
    .select()
    .from(assistantItemTable)
    .where(
      and(eq(assistantItemTable.runId, run.id), eq(assistantItemTable.status, 'streaming')),
    );
  for (const row of rows) {
    await updateItem(tx, emit, row, { status: 'complete' });
  }
}
