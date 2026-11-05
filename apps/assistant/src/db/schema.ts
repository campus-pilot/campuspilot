import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import type { AssistantView } from "@campuspilot/assistant-contract/views";

import { generateId } from "../ids";

/**
 * The assistant service's own Postgres schema. School and user ids are
 * CampusPilot identifiers stored as plain values: the service never joins
 * or references business tables, so either side can change independently.
 */
export const assistantSchema = pgSchema("assistant");

/**
 * In-app assistant persistence.
 *
 * Two histories are kept on purpose, because they answer different questions:
 * - `assistant_item` is what people see: messages and tool calls, each with an
 *   explicit status and the conversation sequence of its latest change, so a
 *   reconnecting client can resume from a cursor.
 * - `assistant_transcript_entry` is what the model sees: the provider's own
 *   content (Claude blocks or Gemini parts), appended in order and keyed for idempotent replay when a
 *   Restate step is retried.
 * Neither is derived from the other.
 */

/** Model provider a conversation runs on (see runtime/providers). */
export const assistantModelProviderEnum = assistantSchema.enum("assistant_model_provider", [
  "anthropic",
  "gemini",
]);

/** Which management surface started a run, recorded to compare the variants. */
export const assistantSurfaceEnum = assistantSchema.enum("assistant_surface", [
  "panel",
  "page",
  "palette",
]);

export const assistantRunStatusEnum = assistantSchema.enum("assistant_run_status", [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const assistantItemKindEnum = assistantSchema.enum("assistant_item_kind", [
  "user_message",
  "assistant_message",
  "tool_call",
  "view",
]);

/**
 * Item lifecycle. Messages use `streaming`/`complete`; tool calls use the
 * remaining states. One enum keeps the snapshot shape flat for clients.
 */
export const assistantItemStatusEnum = assistantSchema.enum("assistant_item_status", [
  "streaming",
  "complete",
  "awaiting_approval",
  "running",
  "succeeded",
  "failed",
  "declined",
  "cancelled",
]);

export const assistantApprovalStatusEnum = assistantSchema.enum("assistant_approval_status", [
  "pending",
  "approved",
  "declined",
  "cancelled",
]);

export const assistantTranscriptRoleEnum = assistantSchema.enum("assistant_transcript_role", [
  "user",
  "assistant",
]);

/** Where the user was when they wrote a message; a hint for the model only. */
export type AssistantPageContext = {
  path: string;
  title?: string;
};

export type AssistantUserMessageBody = {
  text: string;
  pageContext?: AssistantPageContext;
};

export type AssistantAssistantMessageBody = {
  text: string;
};

/** A tool error as returned to the model and shown to the user. */
export type AssistantToolError = {
  code: string;
  message: string;
};

/**
 * One tool call. `access`, `destructive` and `module` are copied from the
 * procedure's MCP metadata when the call is made, so history keeps explaining
 * itself after the catalog changes.
 */
export type AssistantToolCallBody = {
  toolUseId: string;
  toolName: string;
  title: string;
  access: "read" | "write";
  destructive: boolean;
  module: string;
  input: unknown;
  /** Serialized procedure result, truncated for storage and display. */
  output?: string;
  outputTruncated?: boolean;
  error?: AssistantToolError;
  /** The approval this call waited for, when it needed the user's decision. */
  approvalId?: string;
};

/** A view the assistant showed (see @campuspilot/assistant-contract/views). */
export type AssistantViewBody = { view: AssistantView };

export type AssistantItemBody =
  | AssistantUserMessageBody
  | AssistantAssistantMessageBody
  | AssistantToolCallBody
  | AssistantViewBody;

export const assistantConversationTable = assistantSchema.table(
  "assistant_conversation",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("conversation")),
    schoolId: text("school_id").notNull(),
    /** Conversations are private to the user who started them. */
    userId: text("user_id").notNull(),
    title: text("title"),
    /**
     * The provider and model the conversation started on. Its transcript is
     * in that provider's format, so the conversation stays on it.
     */
    provider: assistantModelProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    /** Monotonic change counter; every item or run change takes the next value. */
    lastSequence: integer("last_sequence").notNull().default(0),
    /** Monotonic display-order counter for items. */
    lastPosition: integer("last_position").notNull().default(0),
    /** Monotonic counter for transcript entries. */
    lastTranscriptPosition: integer("last_transcript_position")
      .notNull()
      .default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("assistant_conversation_school_user_updated_idx").on(
      table.schoolId,
      table.userId,
      table.updatedAt,
    ),
  ],
);

/**
 * One assistant turn: a user message and everything the agent did for it.
 * Token usage is recorded per run with its school, so school-level limits can
 * later be computed from facts instead of estimates.
 */
export const assistantRunTable = assistantSchema.table(
  "assistant_run",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("run")),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => assistantConversationTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id").notNull(),
    userId: text("user_id").notNull(),
    /** Client-generated id that makes sending a message idempotent per user. */
    clientRequestId: text("client_request_id").notNull(),
    surface: assistantSurfaceEnum("surface").notNull(),
    status: assistantRunStatusEnum("status").notNull().default("queued"),
    /** Provider and model the run called; null until the run starts. */
    provider: assistantModelProviderEnum("provider"),
    model: text("model"),
    stopRequestedAt: timestamp("stop_requested_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    modelRequestCount: integer("model_request_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens")
      .notNull()
      .default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .notNull()
      .default(0),
    /** Conversation sequence of the run's latest change. */
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    unique("assistant_run_user_client_request_unique").on(
      table.userId,
      table.clientRequestId,
    ),
    index("assistant_run_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("assistant_run_school_created_idx").on(
      table.schoolId,
      table.createdAt,
    ),
  ],
);

export const assistantItemTable = assistantSchema.table(
  "assistant_item",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("item")),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => assistantConversationTable.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => assistantRunTable.id, { onDelete: "cascade" }),
    kind: assistantItemKindEnum("kind").notNull(),
    status: assistantItemStatusEnum("status").notNull(),
    /** Display order within the conversation. */
    position: integer("position").notNull(),
    /** Conversation sequence of the item's latest change. */
    sequence: integer("sequence").notNull(),
    body: jsonb("body").$type<AssistantItemBody>().notNull(),
    /** Idempotency key for items created by retried Restate steps. */
    itemKey: text("item_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("assistant_item_conversation_position_unique").on(
      table.conversationId,
      table.position,
    ),
    unique("assistant_item_conversation_key_unique").on(
      table.conversationId,
      table.itemKey,
    ),
    index("assistant_item_conversation_sequence_idx").on(
      table.conversationId,
      table.sequence,
    ),
  ],
);

/**
 * A write the agent wants to make, waiting for the user's decision. The
 * Restate awakeable id is how the decision resumes the paused run.
 */
export const assistantApprovalTable = assistantSchema.table(
  "assistant_approval",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("approval")),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => assistantConversationTable.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => assistantRunTable.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .unique()
      .references(() => assistantItemTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id").notNull(),
    userId: text("user_id").notNull(),
    toolName: text("tool_name").notNull(),
    status: assistantApprovalStatusEnum("status").notNull().default("pending"),
    awakeableId: text("awakeable_id").notNull(),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("assistant_approval_run_idx").on(table.runId)],
);

/** The model conversation, one message per entry, in model order. */
export const assistantTranscriptEntryTable = assistantSchema.table(
  "assistant_transcript_entry",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => assistantConversationTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => assistantRunTable.id, { onDelete: "cascade" }),
    role: assistantTranscriptRoleEnum("role").notNull(),
    /** Provider-native content, stored exactly as sent or received. */
    content: jsonb("content").$type<unknown[]>().notNull(),
    /** Idempotency key, e.g. `<runId>:model:<step>`. */
    entryKey: text("entry_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.position] }),
    unique("assistant_transcript_entry_key_unique").on(
      table.conversationId,
      table.entryKey,
    ),
  ],
);
