import { z } from 'zod';


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

export const assistantItemSchema = z.discriminatedUnion('kind', [
  assistantUserMessageItemSchema,
  assistantAssistantMessageItemSchema,
  assistantToolCallItemSchema,
]);
export type AssistantItemDto = z.infer<typeof assistantItemSchema>;
export type AssistantToolCallItemDto = z.infer<typeof assistantToolCallItemSchema>;
export type AssistantUserMessageItemDto = z.infer<typeof assistantUserMessageItemSchema>;
export type AssistantReplyItemDto = z.infer<typeof assistantAssistantMessageItemSchema>;

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
});
export type AssistantRunDto = z.infer<typeof assistantRunSchema>;

export const assistantConversationSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  title: z.string().nullable(),
  lastSequence: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AssistantConversationDto = z.infer<typeof assistantConversationSchema>;

/**
 * Stream envelope, after T3 Code's thread subscription: one snapshot with the
 * sequence it reflects, then sequenced upserts of whole entities. A client
 * ignores any upsert whose sequence is not newer than what it holds, so
 * events that raced the snapshot are harmless. `text` frames are ephemeral:
 * the accumulated text of a streaming message, never persisted mid-stream
 * and carrying no sequence.
 */
export const assistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
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
  z.object({ type: z.literal('text'), itemId: z.string(), text: z.string() }),
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
  items: z.array(assistantConversationSchema),
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

export const stopAssistantRunInputSchema = z.object({
  ...schoolScopeShape,
  runId: z.string().min(1),
});
