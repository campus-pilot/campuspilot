import { z } from 'zod';

import { assistantViewSchema } from './views';


/** Longest message a user may send; long pastes belong in documents. */
export const ASSISTANT_MESSAGE_MAX_LENGTH = 8000;

export const assistantSurfaceSchema = z.enum(['panel', 'page', 'palette']);
export type AssistantSurface = z.infer<typeof assistantSurfaceSchema>;

export const assistantRunStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
]);
export type AssistantRunStatus = z.infer<typeof assistantRunStatusSchema>;

/** Statuses after which a run never changes again. */
export const ASSISTANT_TERMINAL_RUN_STATUSES: ReadonlySet<AssistantRunStatus> =
  new Set(['completed', 'failed', 'cancelled']);

export const assistantPageContextSchema = z.object({
  path: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(200).optional(),
});

const itemBaseShape = {
  id: z.string(),
  conversationId: z.string(),
  runId: z.string(),
  position: z.number().int(),
  sequence: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
};

export const assistantToolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const assistantUserMessageItemSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('user_message'),
  status: z.literal('complete'),
  body: z.object({
    text: z.string(),
    pageContext: assistantPageContextSchema.optional(),
  }),
});

export const assistantAssistantMessageItemSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('assistant_message'),
  status: z.enum(['streaming', 'complete']),
  body: z.object({ text: z.string() }),
});

export const assistantToolCallStatusSchema = z.enum([
  'awaiting_approval',
  'running',
  'succeeded',
  'failed',
  'declined',
  'cancelled',
]);

export const assistantToolCallItemSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('tool_call'),
  status: assistantToolCallStatusSchema,
  body: z.object({
    toolUseId: z.string(),
    toolName: z.string(),
    title: z.string(),
    access: z.enum(['read', 'write']),
    destructive: z.boolean(),
    module: z.string(),
    input: z.unknown(),
    output: z.string().optional(),
    outputTruncated: z.boolean().optional(),
    error: assistantToolErrorSchema.optional(),
    /** Present while, and after, the call needed the user's decision. */
    approvalId: z.string().optional(),
  }),
});

/** A view the assistant showed: platform UI rendered from a structured spec. */
export const assistantViewItemSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('view'),
  status: z.literal('complete'),
  body: z.object({ view: assistantViewSchema }),
});

export const assistantItemSchema = z.discriminatedUnion('kind', [
  assistantUserMessageItemSchema,
  assistantAssistantMessageItemSchema,
  assistantToolCallItemSchema,
  assistantViewItemSchema,
]);
export type AssistantItemDto = z.infer<typeof assistantItemSchema>;
export type AssistantToolCallItemDto = z.infer<typeof assistantToolCallItemSchema>;
export type AssistantUserMessageItemDto = z.infer<typeof assistantUserMessageItemSchema>;
export type AssistantReplyItemDto = z.infer<typeof assistantAssistantMessageItemSchema>;
export type AssistantViewItemDto = z.infer<typeof assistantViewItemSchema>;

/**
 * What a run cost and why it failed, for developers. The service sends it
 * only when ASSISTANT_DIAGNOSTICS is on; for everyone else it is null.
 * Token counts are totals over the run's model calls; `inputTokens`
 * excludes cache reads and cache writes, which are counted separately.
 */
export const assistantRunDiagnosticsSchema = z.object({
  /** Null until the run starts. */
  provider: z.string().nullable(),
  model: z.string().nullable(),
  modelRequestCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadInputTokens: z.number().int(),
  cacheCreationInputTokens: z.number().int(),
  /** Estimate from list prices; null when the model's prices are unknown. */
  estimatedCostUsd: z.number().nullable(),
  /** The raw provider or runtime error behind `errorMessage`, if any. */
  errorDetail: z.string().nullable(),
});
export type AssistantRunDiagnosticsDto = z.infer<typeof assistantRunDiagnosticsSchema>;

export const assistantRunSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: assistantRunStatusSchema,
  surface: assistantSurfaceSchema,
  stopRequestedAt: z.date().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  sequence: z.number().int(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  /** Developer diagnostics; null unless the service has them switched on. */
  diagnostics: assistantRunDiagnosticsSchema.nullable(),
});
export type AssistantRunDto = z.infer<typeof assistantRunSchema>;

/**
 * What a conversation needs noticing for in the history list, from its runs
 * that have not finished:
 * - `approval`: one of them waits for the user to approve or decline a change.
 * - `working`: otherwise, one of them is queued or running.
 * Null when every run has finished (or there is none). These are exactly
 * the runs that make the service refuse to delete the conversation, so the
 * list never offers what the service would refuse.
 */
export const assistantConversationAttentionSchema = z.enum(['approval', 'working']);
export type AssistantConversationAttention = z.infer<typeof assistantConversationAttentionSchema>;

/**
 * The attention of a conversation, given its runs (see the schema above).
 * The service's list query applies the same rule in SQL; a client that holds
 * a conversation's live runs uses this to stay current between refreshes.
 */
export function assistantConversationAttention(
  runs: readonly { status: AssistantRunStatus }[],
): AssistantConversationAttention | null {
  if (runs.some((run) => run.status === 'awaiting_approval')) return 'approval';
  if (runs.some((run) => run.status === 'queued' || run.status === 'running')) return 'working';
  return null;
}

export const assistantConversationSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  title: z.string().nullable(),
  lastSequence: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AssistantConversationDto = z.infer<typeof assistantConversationSchema>;

/** A conversation as a row of the history list: with its attention. */
export const assistantConversationListItemSchema = assistantConversationSchema.extend({
  attention: assistantConversationAttentionSchema.nullable(),
});
export type AssistantConversationListItemDto = z.infer<typeof assistantConversationListItemSchema>;

/**
 * Stream envelope, after T3 Code's thread subscription:
 * - `snapshot`: the whole visible state, sent on a first subscribe or when a
 *   resume would be too large.
 * - `resume`: only the entities changed since the client's `afterSequence`.
 * - `item`/`run`/`conversation`: sequenced upserts of whole entities; a client
 *   ignores any whose sequence is not newer than what it holds.
 * - `text`: a streaming message's new text as `{offset, delta}` (not the
 *   whole text each time); ephemeral and unsequenced.
 * - `synchronized`: the snapshot or resume is complete; live from here.
 * - `heartbeat`: sent while idle so a client can tell a quiet stream from a
 *   dead connection.
 */
export const assistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    conversation: assistantConversationSchema,
    items: z.array(assistantItemSchema),
    runs: z.array(assistantRunSchema),
  }),
  z.object({
    type: z.literal('resume'),
    conversation: assistantConversationSchema,
    items: z.array(assistantItemSchema),
    runs: z.array(assistantRunSchema),
  }),
  z.object({ type: z.literal('item'), item: assistantItemSchema }),
  z.object({ type: z.literal('run'), run: assistantRunSchema }),
  z.object({
    type: z.literal('conversation'),
    conversation: assistantConversationSchema,
  }),
  z.object({
    type: z.literal('text'),
    itemId: z.string(),
    /** Where `delta` starts in the message's full text. */
    offset: z.number().int().nonnegative(),
    delta: z.string(),
  }),
  z.object({ type: z.literal('synchronized') }),
  z.object({ type: z.literal('heartbeat') }),
]);
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;

const schoolScopeShape = { schoolId: z.string().min(1) };

export const assistantStatusInputSchema = z.object(schoolScopeShape);
export const assistantStatusOutputSchema = z.object({
  /** Whether the platform has an assistant model configured at all. */
  configured: z.boolean(),
  /** Whether this user may start a run in this school right now. */
  available: z.boolean(),
  /** Why the assistant is unavailable, when it is. */
  unavailableReason: z.string().nullable(),
});

/** Page size for conversation lists, matching the platform's list limit. */
export const ASSISTANT_LIST_PAGE_SIZE = 20;

export const listAssistantConversationsInputSchema = z.object({
  ...schoolScopeShape,
  page: z.number().int().positive().default(1),
});
export const listAssistantConversationsOutputSchema = z.object({
  items: z.array(assistantConversationListItemSchema),
  pagination: z.object({
    nextCursor: z.string().nullable(),
    currentPage: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
  }),
});

export const assistantSnapshotSchema = z.object({
  conversation: assistantConversationSchema,
  items: z.array(assistantItemSchema),
  runs: z.array(assistantRunSchema),
});
export type AssistantSnapshot = z.infer<typeof assistantSnapshotSchema>;

export const assistantConversationInputSchema = z.object({
  ...schoolScopeShape,
  conversationId: z.string().min(1),
});

export const subscribeAssistantConversationInputSchema = assistantConversationInputSchema.extend({
  /**
   * The highest sequence the client already holds. When set, the stream starts
   * with a `resume` of what changed since, instead of a full snapshot.
   */
  afterSequence: z.number().int().nonnegative().optional(),
});

export const sendAssistantMessageInputSchema = z.object({
  ...schoolScopeShape,
  /** Omit to start a new conversation. */
  conversationId: z.string().min(1).optional(),
  /** Client-generated id; resending the same id returns the original run. */
  clientRequestId: z.string().uuid(),
  text: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX_LENGTH),
  surface: assistantSurfaceSchema,
  pageContext: assistantPageContextSchema.optional(),
});
export const sendAssistantMessageOutputSchema = z.object({
  conversation: assistantConversationSchema,
  run: assistantRunSchema,
  item: assistantUserMessageItemSchema,
});

export const assistantApprovalDecisionSchema = z.enum(['approve', 'decline']);

export const respondToAssistantApprovalInputSchema = z.object({
  ...schoolScopeShape,
  approvalId: z.string().min(1),
  decision: assistantApprovalDecisionSchema,
});

/** The conversation that was deleted, with everything in it. */
export const deleteAssistantConversationOutputSchema = z.object({ id: z.string() });

export const stopAssistantRunInputSchema = z.object({
  ...schoolScopeShape,
  runId: z.string().min(1),
});
