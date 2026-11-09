import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";

export const dataMigrationRunStatusEnum = pgEnum("data_migration_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

/**
 * One run of a code-defined data migration (`packages/api/src/data-migrations`).
 * Data migrations change existing rows (backfills); schema changes stay in SQL
 * migrations. The row is the run's outbox entry (the API hands it to the
 * `DataMigrationControl` Restate service), its status store and its
 * checkpoint. It is platform-owned, not school-owned.
 *
 * - `status`: `pending` (requested, not started by a worker yet), `running`,
 *   `completed`, `failed`. At most one run per migration is `pending` or
 *   `running` at a time (partial unique index).
 * - `dry_run` is its own fact: a dry run executes every batch inside a
 *   savepoint that is rolled back, so it only fills in the counts, the
 *   checkpoint and the skipped report of this row.
 * - `checkpoint` is the opaque keyset cursor after the last committed batch.
 *   It is written in the same transaction as that batch's changes, so a crash
 *   resumes exactly after the last committed batch.
 * - Counts: `processed = changed + skipped + unchanged`; `skipped` items are
 *   listed in `data_migration_skipped_item`.
 */
export const dataMigrationRunTable = pgTable(
  "data_migration_run",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("dataMigrationRun")),
    /** Stable registry ID of the migration; never reused for another migration. */
    migrationId: text("migration_id").notNull(),
    dryRun: boolean("dry_run").notNull(),
    status: dataMigrationRunStatusEnum("status").notNull().default("pending"),
    /**
     * The platform admin who requested the run. Null when the API server
     * registered it on boot. Set null if the account is deleted.
     */
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When Restate durably accepted the hand-over (a one-way `/send` to
     * `DataMigrationControl.start`). Accepted does not mean a worker runs it.
     */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Restate invocation of that control send. */
    submitInvocationId: text("submit_invocation_id"),
    /** Hand-over attempts, successful or not. */
    submitAttempts: integer("submit_attempts").notNull().default(0),
    /** Safe summary of the last failed hand-over, shown while it is retried. */
    lastSubmitError: text("last_submit_error"),
    /** Restate invocation of the `DataMigration` workflow run. */
    invocationId: text("invocation_id"),
    /** Opaque keyset cursor after the last committed batch; null before the first. */
    checkpoint: text("checkpoint"),
    batchCount: integer("batch_count").notNull().default(0),
    processedCount: integer("processed_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Safe failure summary (status `failed`); never SQL, parameters or personal data. */
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("data_migration_run_active_unique")
      .on(table.migrationId)
      .where(sql`${table.status} in ('pending', 'running')`),
    index("data_migration_run_migration_idx").on(
      table.migrationId,
      table.requestedAt,
    ),
    index("data_migration_run_status_idx").on(table.status, table.requestedAt),
  ],
);

/**
 * Items a data migration run could not migrate and reports instead, keyed by
 * the item's own key (for example an admission ID) so a retried batch never
 * reports an item twice. `detail` holds IDs and reason codes only, never
 * personal data such as phone numbers or names.
 */
export const dataMigrationSkippedItemTable = pgTable(
  "data_migration_skipped_item",
  {
    runId: text("run_id")
      .notNull()
      .references(() => dataMigrationRunTable.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    reason: text("reason").notNull(),
    detail: jsonb("detail").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.itemKey] })],
);
