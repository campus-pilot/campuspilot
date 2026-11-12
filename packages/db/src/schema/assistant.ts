import type { AssistantView } from "@campuspilot/assistant-contract/views";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";
import { roles } from "./jsonb/role";
import { schoolTable } from "./school";

/**
 * In-app assistant persistence (`packages/assistant`), in the main database.
 *
 * Two histories are kept on purpose, because they answer different questions:
 * - `assistant_item` is what people see: messages and tool calls, each with an
 *   explicit status and the conversation sequence of its latest change, so a
 *   reconnecting client can resume from a cursor.
 * - `assistant_transcript_entry` is what the model sees: the provider's own
 *   content (Claude blocks or Gemini parts), appended in order and keyed for
 *   idempotent replay when a Restate step is retried.
 * Neither is derived from the other.
 *
 * Ownership:
 * - `school_id` references the school with `ON DELETE CASCADE`: a deleted
 *   school takes its conversations, runs and costs with it.
 * - `user_id` is a plain value without a foreign key: a deleted staff
 *   member's runs and costs are kept, so spend and bills stay complete.
 *
 * Only the assistant's own code writes these rows (the API's `/model/*`
 * procedures and the worker's turn loop). The model never reaches them: its
 * only access to school data is the API's MCP endpoint.
 */

/** Model provider a conversation runs on (see packages/assistant/src/runtime/providers). */
export const assistantModelProviderEnum = pgEnum("assistant_model_provider", [
  "anthropic",
  "gemini",
]);

/**
 * What a model request was made for. `chat` requests belong to an assistant
 * run; `question_paper` requests belong to a question paper generation job
 * (`exam_question_paper_job`), which has no run. Spend, limits and usage count
 * both; the usage pages break the total down by this value.
 */
export const assistantModelRequestSourceEnum = pgEnum("assistant_model_request_source", [
  "chat",
  "question_paper",
]);

/** Which management surface started a run, recorded to compare the variants. */
export const assistantSurfaceEnum = pgEnum("assistant_surface", [
  "panel",
  "page",
  "palette",
]);

export const assistantRunStatusEnum = pgEnum("assistant_run_status", [
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
]);

export const assistantItemKindEnum = pgEnum("assistant_item_kind", [
  "user_message",
  "assistant_message",
  "tool_call",
  "view",
]);

/**
 * Item lifecycle. Messages use `streaming`/`complete`; tool calls use the
 * remaining states. One enum keeps the snapshot shape flat for clients.
 */
export const assistantItemStatusEnum = pgEnum("assistant_item_status", [
  "streaming",
  "complete",
  "awaiting_approval",
  "running",
  "succeeded",
  "failed",
  "declined",
  "cancelled",
]);

export const assistantApprovalStatusEnum = pgEnum("assistant_approval_status", [
  "pending",
  "approved",
  "declined",
  "cancelled",
]);

export const assistantTranscriptRoleEnum = pgEnum("assistant_transcript_role", [
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
  /**
   * When a write was handed to the API (ISO time). Saved before the call is
   * made, so a step retried after a crash can tell the write may already
   * have happened and must not be sent a second time. Reads never set it:
   * repeating a read is harmless.
   */
  executionStartedAt?: string;
};

/** A view the assistant showed (see @campuspilot/assistant-contract/views). */
export type AssistantViewBody = { view: AssistantView };

export type AssistantItemBody =
  | AssistantUserMessageBody
  | AssistantAssistantMessageBody
  | AssistantToolCallBody
  | AssistantViewBody;

export const assistantConversationTable = pgTable(
  "assistant_conversation",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("assistantConversation")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    /**
     * Conversations are private to the user who started them. No foreign
     * key: a deleted user's conversations and their costs are kept.
     */
    userId: text("user_id").notNull(),
    title: text("title"),
    /**
     * The provider the conversation runs on, and the model it started on.
     * Its transcript is in that provider's format, so the conversation stays
     * on the provider. It does not stay on the model: each run calls the
     * model the provider is configured with at that time, and records it on
     * the run. `model` here is history, never used to pick a model.
     */
    provider: assistantModelProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    /** Monotonic change counter; every item or run change takes the next value. */
    lastSequence: integer("last_sequence").notNull().default(0),
    /** Monotonic display-order counter for items. */
    lastPosition: integer("last_position").notNull().default(0),
    /** Monotonic counter for transcript entries. */
    lastTranscriptPosition: integer("last_transcript_position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * When the user deleted the conversation; null while it is live. Deleting
     * is soft: the conversation, its runs, items and transcript stay, so its
     * model requests' costs stay linked to their run and conversation. Every
     * user-facing read treats a deleted conversation as not found, and the
     * worker never starts or continues a run of one.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Who deleted it (today always its owner); its own fact, null while live. No foreign key, like `user_id`. */
    deletedBy: text("deleted_by"),
  },
  (table) => [
    /** The history list: a user's live conversations in a school, newest first. */
    index("assistant_conversation_school_user_updated_idx")
      .on(table.schoolId, table.userId, table.updatedAt)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * One assistant turn: a user message and everything the agent did for it.
 *
 * Token usage and `cost_usd` are running sums of the run's
 * `assistant_model_request` rows, added in the same transaction as each row,
 * so the run's total never disagrees with its requests.
 *
 * The run is also the outbox entry for starting its turn in the worker
 * (`handed_over_at`, `handover_attempts`, `last_handover_error`): the API
 * saves the run, hands it to Restate after commit, and its sweep re-sends
 * any run Restate has not accepted (`packages/assistant/src/dispatch.ts`).
 */
export const assistantRunTable = pgTable(
  "assistant_run",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("assistantRun")),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => assistantConversationTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    /** No foreign key: a deleted user's runs and costs are kept. */
    userId: text("user_id").notNull(),
    /** Client-generated id that makes sending a message idempotent per user. */
    clientRequestId: text("client_request_id").notNull(),
    surface: assistantSurfaceEnum("surface").notNull(),
    status: assistantRunStatusEnum("status").notNull().default("queued"),
    /**
     * The provider the run called and the model that answered its latest
     * request, as the provider reported it; null until the run starts.
     */
    provider: assistantModelProviderEnum("provider"),
    model: text("model"),
    stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /**
     * The raw provider or runtime error behind a failure. Users see
     * `errorMessage`; this is for developers (diagnostics, logs).
     */
    errorDetail: text("error_detail"),
    modelRequestCount: integer("model_request_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    /**
     * Sum of the run's `assistant_model_request.cost_usd`, in USD. Saved,
     * never recomputed from prices.
     */
    costUsd: numeric("cost_usd", { precision: 14, scale: 8 }).notNull().default("0"),
    /** Conversation sequence of the run's latest change. */
    sequence: integer("sequence").notNull(),
    /** When Restate accepted the start of this run's turn; null until then. */
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    /** How often the API tried to hand the start over. */
    handoverAttempts: integer("handover_attempts").notNull().default(0),
    /** Why the latest hand-over failed (a safe one-line text), when it did. */
    lastHandoverError: text("last_handover_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("assistant_run_user_client_request_unique").on(table.userId, table.clientRequestId),
    index("assistant_run_conversation_idx").on(table.conversationId, table.createdAt),
    index("assistant_run_school_created_idx").on(table.schoolId, table.createdAt),
    /** The outbox sweep's scan: runs whose start Restate has not accepted. */
    index("assistant_run_handover_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.handedOverAt} is null and ${table.status} = 'queued'`),
    /** The sweep's scan for runs Restate accepted that never started. */
    index("assistant_run_unstarted_idx")
      .on(table.handedOverAt)
      .where(sql`${table.startedAt} is null and ${table.status} = 'queued'`),
  ],
);

export const assistantItemTable = pgTable(
  "assistant_item",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("assistantItem")),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("assistant_item_conversation_position_unique").on(table.conversationId, table.position),
    unique("assistant_item_conversation_key_unique").on(table.conversationId, table.itemKey),
    index("assistant_item_conversation_sequence_idx").on(table.conversationId, table.sequence),
    index("assistant_item_run_idx").on(table.runId),
  ],
);

/**
 * A write the agent wants to make, waiting for the user's decision. The
 * Restate awakeable id is how the decision resumes the paused run.
 *
 * A decided approval is also the outbox entry for waking the run:
 * `resolution_handed_over_at` stays null until Restate accepted the signed
 * call that resolves the awakeable, and the API's sweep re-sends decided
 * approvals that were not handed over (`packages/assistant/src/dispatch.ts`).
 */
export const assistantApprovalTable = pgTable(
  "assistant_approval",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("assistantApproval")),
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
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    toolName: text("tool_name").notNull(),
    status: assistantApprovalStatusEnum("status").notNull().default("pending"),
    awakeableId: text("awakeable_id").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** When Restate accepted the call that wakes the run with the decision. */
    resolutionHandedOverAt: timestamp("resolution_handed_over_at", { withTimezone: true }),
    /** How often the API tried to hand the decision over. */
    resolutionHandoverAttempts: integer("resolution_handover_attempts").notNull().default(0),
    /** Why the latest hand-over of the decision failed, when it did. */
    lastResolutionHandoverError: text("last_resolution_handover_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("assistant_approval_run_idx").on(table.runId),
    /** The outbox sweep's scan: decisions Restate has not accepted. */
    index("assistant_approval_resolution_pending_idx")
      .on(table.decidedAt)
      .where(sql`${table.resolutionHandedOverAt} is null`),
  ],
);

/** The model conversation, one message per entry, in model order. */
export const assistantTranscriptEntryTable = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.position] }),
    unique("assistant_transcript_entry_key_unique").on(table.conversationId, table.entryKey),
    index("assistant_transcript_entry_run_idx").on(table.runId),
  ],
);

/**
 * One model request and what it cost, saved when the response arrives (or
 * when a stopped request is abandoned, see `usage_complete`).
 *
 * Prices are the ones the worker was configured with at that moment (USD per
 * million tokens, from env), stored with the row, and `cost_usd` is computed
 * from them once, in Postgres `numeric`: nothing is ever recomputed. One row
 * per request, not per run, because a release with new prices can land in
 * the middle of a run. Spend for limits and the admin usage pages is the sum
 * of these rows.
 *
 * `request_key` (`<runId>:model:<step>`) makes the insert idempotent when a
 * durable step is retried.
 */
export const assistantModelRequestTable = pgTable(
  "assistant_model_request",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("assistantModelRequest")),
    /**
     * The run that made the request. `ON DELETE NO ACTION`: a run can never be
     * deleted while it has cost rows, so costs are never dropped or unlinked
     * by deleting a run or conversation (users delete conversations softly).
     * Rows go only with their school (`school_id` cascades, and Postgres
     * checks this constraint at the end of that statement, when the rows are
     * gone too) or through `purge_demo_school`, which deletes them first.
     * Every spend and usage read uses this table, never runs.
     */
    runId: text("run_id").references(() => assistantRunTable.id, { onDelete: "no action" }),
    /**
     * What the request was made for. Its own column, never inferred from which
     * of `run_id` / `question_paper_job_id` is set (the CHECK ties them
     * together). Every writer states it: there is no default.
     */
    source: assistantModelRequestSourceEnum("source").notNull(),
    /**
     * The question paper generation job that made the request (`qpj_...`), for
     * `source = 'question_paper'`. A plain value without a foreign key: deleting
     * a paper (and with it its jobs) must not drop or unlink what it cost.
     */
    questionPaperJobId: text("question_paper_job_id"),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    /** No foreign key: a deleted user's costs are kept. */
    userId: text("user_id").notNull(),
    requestKey: text("request_key").notNull().unique(),
    /**
     * Whether the token counts are the provider's final usage of the request.
     * False for a request stopped mid-stream: its counts are whatever the
     * provider had reported before the abort (possibly nothing, then zeros),
     * so the cost is a lower bound. Its own fact, never inferred from zero
     * tokens; the billing page counts such rows.
     */
    usageComplete: boolean("usage_complete").notNull(),
    provider: assistantModelProviderEnum("provider").notNull(),
    /** The model the worker asked for (its configured model). */
    requestedModel: text("requested_model").notNull(),
    /** The model that answered, as the provider reported it. */
    answeredModel: text("answered_model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull(),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull(),
    inputUsdPerMtok: numeric("input_usd_per_mtok", { precision: 14, scale: 6 }).notNull(),
    outputUsdPerMtok: numeric("output_usd_per_mtok", { precision: 14, scale: 6 }).notNull(),
    cacheReadUsdPerMtok: numeric("cache_read_usd_per_mtok", { precision: 14, scale: 6 }).notNull(),
    cacheWriteUsdPerMtok: numeric("cache_write_usd_per_mtok", { precision: 14, scale: 6 }).notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("assistant_model_request_school_created_idx").on(table.schoolId, table.createdAt),
    index("assistant_model_request_created_idx").on(table.createdAt),
    index("assistant_model_request_run_idx").on(table.runId),
    index("assistant_model_request_school_source_created_idx").on(table.schoolId, table.source, table.createdAt),
    check(
      "assistant_model_request_source_owner_check",
      sql`(${table.source} = 'chat' and ${table.runId} is not null and ${table.questionPaperJobId} is null)
        or (${table.source} = 'question_paper' and ${table.runId} is null and ${table.questionPaperJobId} is not null)`,
    ),
  ],
);

/**
 * The school roles a school has switched the assistant on for. A row means
 * "on"; switching a role off deletes its row. Only roles the platform made
 * eligible (the `assistant` feature flag's `eligibleRoles`) can be switched
 * on, but a stored row is kept when its role later stops being eligible: it
 * then grants nothing and the school's settings show it as unavailable.
 * Managed by the school's principal or manager
 * (`school.assistant.access.manage`).
 */
export const schoolAssistantAccessRoleTable = pgTable(
  "school_assistant_access_role",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: roles }).notNull(),
    /** Who switched the role on; null after that account is deleted. */
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.role] }),
    index("school_assistant_access_role_updated_by_idx").on(table.updatedBy),
  ],
);

export type AssistantConversationRow = typeof assistantConversationTable.$inferSelect;
export type AssistantRunRow = typeof assistantRunTable.$inferSelect;
export type AssistantItemRow = typeof assistantItemTable.$inferSelect;
export type AssistantApprovalRow = typeof assistantApprovalTable.$inferSelect;
export type AssistantModelRequestRow = typeof assistantModelRequestTable.$inferSelect;
