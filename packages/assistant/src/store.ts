import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { env } from '@campuspilot/env/assistant';

import {
  assistantConversationListItemSchema,
  assistantConversationSchema,
  assistantItemSchema,
  assistantRunSchema,
  type AssistantConversationDto,
  type AssistantConversationListItemDto,
  type AssistantItemDto,
  type AssistantRunDto,
  type AssistantRunStatus,
  type AssistantStreamEvent,
  type AssistantSurface,
} from '@campuspilot/assistant-contract/dto';

import type { AssistantDatabase, AssistantExecutor } from './db';
import {
  assistantApprovalTable,
  assistantConversationTable,
  assistantItemTable,
  assistantModelRequestTable,
  assistantRunTable,
  assistantTranscriptEntryTable,
  type AssistantItemBody,
} from '@campuspilot/db/schema/assistant';
import type { ModelPrices } from './runtime/providers/config';
import { publishAssistantEvent } from './events';
import { log } from './log';

type ConversationRow = typeof assistantConversationTable.$inferSelect;
export type RunRow = typeof assistantRunTable.$inferSelect;
type ItemRow = typeof assistantItemTable.$inferSelect;

export type AssistantChange = Exclude<AssistantStreamEvent, { type: 'snapshot' | 'text' }>;
/** Records a change to publish once the surrounding transaction commits. */
export type EmitAssistantChange = (conversationId: string, change: AssistantChange) => void;

/** A conversation as clients see it. */
export function toConversationDto(row: ConversationRow): AssistantConversationDto {
  return assistantConversationSchema.parse(row);
}

/**
 * Whether the conversation has a run in one of `statuses`, as a correlated
 * subquery of the list query (an index lookup on the conversation's runs).
 * The run table gets its own alias and the outer row is named in full:
 * drizzle writes bare column names inside `sql`, and a bare `id` in the
 * subquery would mean the run's id, not the conversation's.
 */
const hasRunIn = (statuses: AssistantRunStatus[]) =>
  sql<boolean>`exists (select 1 from ${assistantRunTable} as run where run.conversation_id = ${assistantConversationTable}.id and run.status in (${sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )}))`;

/**
 * One page of a user's conversations in a school, newest first, each with
 * its attention (`assistantConversationAttention`, applied here in SQL), and
 * how many there are in all. The page is one statement: no query per row.
 */
export async function listConversations(
  db: AssistantExecutor,
  input: { schoolId: string; userId: string; page: number; pageSize: number },
): Promise<{ items: AssistantConversationListItemDto[]; totalItems: number }> {
  const where = and(
    eq(assistantConversationTable.schoolId, input.schoolId),
    eq(assistantConversationTable.userId, input.userId),
    isNull(assistantConversationTable.deletedAt),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        conversation: assistantConversationTable,
        awaitingApproval: hasRunIn(['awaiting_approval']),
        working: hasRunIn(['queued', 'running']),
      })
      .from(assistantConversationTable)
      .where(where)
      .orderBy(desc(assistantConversationTable.updatedAt), desc(assistantConversationTable.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(assistantConversationTable).where(where),
  ]);
  return {
    items: rows.map((row) =>
      assistantConversationListItemSchema.parse({
        ...row.conversation,
        attention: row.awaitingApproval ? 'approval' : row.working ? 'working' : null,
      }),
    ),
    totalItems: total?.value ?? 0,
  };
}

/** Statuses of a run that has not finished: it is waiting to start, working, or waiting for the user. */
const UNFINISHED_RUN_STATUSES: AssistantRunStatus[] = ['queued', 'running', 'awaiting_approval'];

/**
 * Deletes a conversation for its user, softly: `deleted_at` and `deleted_by`
 * are set and every row stays (runs, items, approvals, transcript), so the
 * costs of its model requests stay linked to their run and conversation.
 * From then on every user-facing read treats it as not found
 * (`findOwnedConversation`, the list) and the worker does not start or
 * continue its runs. Refused while one of its runs has not finished: a turn
 * in progress would go on with a conversation that is gone for its user.
 *
 * The conversation row is locked first. Saving a message or a run's
 * progress updates that row, so nothing can start or advance a run between
 * the check and the delete.
 */
export async function deleteConversation(
  db: AssistantDatabase,
  conversationId: string,
  deletedBy: string,
): Promise<'deleted' | 'busy' | 'missing'> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: assistantConversationTable.id, deletedAt: assistantConversationTable.deletedAt })
      .from(assistantConversationTable)
      .where(eq(assistantConversationTable.id, conversationId))
      .for('update');
    if (!locked || locked.deletedAt) return 'missing';
    const [unfinished] = await tx
      .select({ id: assistantRunTable.id })
      .from(assistantRunTable)
      .where(
        and(
          eq(assistantRunTable.conversationId, conversationId),
          inArray(assistantRunTable.status, UNFINISHED_RUN_STATUSES),
        ),
      )
      .limit(1);
    if (unfinished) return 'busy';
    await tx
      .update(assistantConversationTable)
      .set({ deletedAt: new Date(), deletedBy })
      .where(eq(assistantConversationTable.id, conversationId));
    return 'deleted';
  });
}

/**
 * Locks a conversation for a new run and says whether it is still live. A
 * message saved into a conversation takes this lock before its run, so it
 * cannot slip in after a concurrent delete (which takes the same lock).
 */
export async function lockLiveConversation(tx: AssistantExecutor, conversationId: string): Promise<boolean> {
  const [row] = await tx
    .select({ deletedAt: assistantConversationTable.deletedAt })
    .from(assistantConversationTable)
    .where(eq(assistantConversationTable.id, conversationId))
    .for('update');
  return Boolean(row) && row!.deletedAt === null;
}

/**
 * A run's usage, saved cost and raw error, for developer diagnostics.
 * `model` is the model that served the run's latest request (see
 * `modelStep`). The cost is the run's saved `cost_usd` (the sum of its
 * model requests at the prices in force when each was made), never
 * recomputed.
 */
function runDiagnostics(row: RunRow): AssistantRunDto['diagnostics'] {
  return {
    provider: row.provider,
    model: row.model,
    modelRequestCount: row.modelRequestCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    costUsd: row.costUsd,
    errorDetail: row.errorDetail,
  };
}

/**
 * Runs reach clients only through here, so diagnostics are attached in one
 * place and only while ASSISTANT_DIAGNOSTICS is on.
 */
export function toRunDto(row: RunRow): AssistantRunDto {
  return assistantRunSchema.parse({ ...row, diagnostics: env.ASSISTANT_DIAGNOSTICS ? runDiagnostics(row) : null });
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

/** A live conversation the user owns in that school, or null (a deleted one is not found). */
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
        isNull(assistantConversationTable.deletedAt),
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

/**
 * The run, with its row locked until the transaction ends. Stopping a run
 * updates the same row, so whoever holds the lock sees the other's change
 * once it has committed and never misses it.
 */
export async function lockRun(tx: AssistantExecutor, runId: string): Promise<RunRow | null> {
  const [row] = await tx.select().from(assistantRunTable).where(eq(assistantRunTable.id, runId)).for('update');
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
  errorDetail: string | null;
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
): Promise<AssistantRunDto> {
  const counters = await allocate(tx, run.conversationId, { sequence: true });
  const [row] = await tx
    .update(assistantRunTable)
    .set({ ...patch, sequence: counters.lastSequence })
    .where(eq(assistantRunTable.id, run.id))
    .returning();
  const dto = toRunDto(row!);
  emit(run.conversationId, { type: 'run', run: dto });
  return dto;
}

/**
 * The request key for the next failed-but-billed attempt of a model step:
 * `<stepKey>:attempt:<n>`, one more than the attempts saved so far. A step's
 * attempts run one after another (the conversation's object is exclusive),
 * so counting is enough; the unique key still refuses a duplicate.
 */
export async function nextFailedAttemptKey(db: AssistantExecutor, stepKey: string): Promise<string> {
  const [row] = await db
    .select({ attempts: count() })
    .from(assistantModelRequestTable)
    .where(sql`${assistantModelRequestTable.requestKey} like ${`${stepKey}:attempt:%`}`);
  return `${stepKey}:attempt:${(row?.attempts ?? 0) + 1}`;
}

/**
 * Saves one answered model request with its tokens, the prices it was made
 * at and its cost, and adds them to the run's totals, in the caller's
 * transaction. The cost is computed once, in Postgres `numeric` (USD per
 * million tokens × tokens ÷ 10⁶, stored at 8 decimals), and the run's
 * `cost_usd` grows by exactly the stored amount, so the run always equals
 * the sum of its requests.
 *
 * Only for chat (`source = 'chat'`, a run owns the request). A question paper
 * generation job has no run: its requests are saved by
 * `recordQuestionPaperRequest` in the API's `workflows/question-paper/cost.ts`
 * (same cost expression, `source = 'question_paper'`).
 *
 * Idempotent on `requestKey`: a durable step retried after it saved the
 * request adds nothing a second time (returns false). It takes the run's
 * row lock before the conversation's (in the `updateRun` that follows), the
 * order a stop and an approval take them in.
 */
export async function recordModelRequest(
  tx: AssistantExecutor,
  input: {
    runId: string;
    schoolId: string;
    userId: string;
    requestKey: string;
    provider: RunRow['provider'] & string;
    requestedModel: string;
    answeredModel: string;
    usage: AssistantUsage;
    /** False when `usage` is what a stopped request had reported, not its final usage. */
    usageComplete: boolean;
    prices: ModelPrices;
  },
): Promise<boolean> {
  const { usage, prices } = input;
  const [saved] = await tx
    .insert(assistantModelRequestTable)
    .values({
      source: 'chat',
      runId: input.runId,
      schoolId: input.schoolId,
      userId: input.userId,
      requestKey: input.requestKey,
      provider: input.provider,
      requestedModel: input.requestedModel,
      answeredModel: input.answeredModel,
      usageComplete: input.usageComplete,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      inputUsdPerMtok: prices.inputUsdPerMtok,
      outputUsdPerMtok: prices.outputUsdPerMtok,
      cacheReadUsdPerMtok: prices.cacheReadUsdPerMtok,
      cacheWriteUsdPerMtok: prices.cacheWriteUsdPerMtok,
      costUsd: sql`(${usage.inputTokens}::numeric * ${prices.inputUsdPerMtok}::numeric
        + ${usage.outputTokens}::numeric * ${prices.outputUsdPerMtok}::numeric
        + ${usage.cacheReadInputTokens}::numeric * ${prices.cacheReadUsdPerMtok}::numeric
        + ${usage.cacheCreationInputTokens}::numeric * ${prices.cacheWriteUsdPerMtok}::numeric) / 1000000`,
    })
    .onConflictDoNothing({ target: assistantModelRequestTable.requestKey })
    .returning({ costUsd: assistantModelRequestTable.costUsd });
  if (!saved) return false;
  await tx
    .update(assistantRunTable)
    .set({
      modelRequestCount: sql`${assistantRunTable.modelRequestCount} + 1`,
      inputTokens: sql`${assistantRunTable.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${assistantRunTable.outputTokens} + ${usage.outputTokens}`,
      cacheReadInputTokens: sql`${assistantRunTable.cacheReadInputTokens} + ${usage.cacheReadInputTokens}`,
      cacheCreationInputTokens: sql`${assistantRunTable.cacheCreationInputTokens} + ${usage.cacheCreationInputTokens}`,
      costUsd: sql`${assistantRunTable.costUsd} + ${saved.costUsd}::numeric`,
    })
    .where(eq(assistantRunTable.id, input.runId));
  return true;
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

/**
 * Approves or declines a pending approval unless its run was asked to stop,
 * atomically with a stop: the run's row is locked first (the order a stop
 * takes it in), so either the stop committed before (and the decision is
 * refused, `stopped`) or it runs after (and finds the approval decided).
 * `decided` is null when the approval was no longer pending.
 */
export async function decideApprovalUnlessStopped(
  db: AssistantDatabase,
  input: { approvalId: string; runId: string; status: 'approved' | 'declined' },
): Promise<{ stopped: true } | { stopped: false; decided: ApprovalRow | null }> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.runId);
    if (!run || run.stopRequestedAt) return { stopped: true };
    return { stopped: false, decided: await decideApproval(tx, input.approvalId, input.status) };
  });
}

/**
 * An approval of the run that a stop cancelled and whose cancel the worker
 * has not accepted yet, so a repeated Stop can hand it over again.
 */
export async function findUnhandedCancelledApprovalForRun(
  db: AssistantExecutor,
  runId: string,
): Promise<ApprovalRow | null> {
  const [row] = await db
    .select()
    .from(assistantApprovalTable)
    .where(
      and(
        eq(assistantApprovalTable.runId, runId),
        eq(assistantApprovalTable.status, 'cancelled'),
        isNull(assistantApprovalTable.resolutionHandedOverAt),
      ),
    )
    .limit(1);
  return row ?? null;
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
  if (row) {
    emit(conversationId, {
      type: 'conversation',
      conversation: toConversationDto(row),
    });
  }
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

/** A run's tool calls that have not reached a final status. */
export async function findOpenToolCalls(
  tx: AssistantExecutor,
  run: { id: string },
): Promise<ItemRow[]> {
  return tx
    .select()
    .from(assistantItemTable)
    .where(
      and(
        eq(assistantItemTable.runId, run.id),
        eq(assistantItemTable.kind, 'tool_call'),
        inArray(assistantItemTable.status, ['running', 'awaiting_approval']),
      ),
    );
}

/**
 * What changed after `afterSequence`: the entities whose latest change is
 * newer, for a resume instead of a full snapshot. Returns null when the
 * change set is larger than `limit` or the cursor is ahead of the
 * conversation (a stale or foreign cursor), so the caller sends a snapshot.
 */
export async function loadChangesSince(
  db: AssistantDatabase,
  conversationId: string,
  afterSequence: number,
  limit = 200,
): Promise<AssistantSnapshot | null> {
  return db.transaction(async (tx) => {
    const conversation = await findConversation(tx, conversationId);
    if (!conversation || afterSequence > conversation.lastSequence) return null;
    const [items, runs] = await Promise.all([
      tx
        .select()
        .from(assistantItemTable)
        .where(and(eq(assistantItemTable.conversationId, conversationId), gt(assistantItemTable.sequence, afterSequence)))
        .orderBy(asc(assistantItemTable.position))
        .limit(limit + 1),
      tx
        .select()
        .from(assistantRunTable)
        .where(and(eq(assistantRunTable.conversationId, conversationId), gt(assistantRunTable.sequence, afterSequence)))
        .orderBy(asc(assistantRunTable.createdAt), asc(assistantRunTable.id))
        .limit(limit + 1),
    ]);
    if (items.length + runs.length > limit) return null;
    return {
      conversation: toConversationDto(conversation),
      items: items.map(toItemDto),
      runs: runs.map(toRunDto),
    };
  });
}
