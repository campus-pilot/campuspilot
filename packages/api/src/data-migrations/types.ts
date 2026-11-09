import type { DatabaseExecutor } from '@campuspilot/db';

/** An item a batch could not migrate; reported on the run instead. */
export type DataMigrationSkippedItem = {
  /** Stable, unique key of the item within the migration (e.g. an admission ID). */
  itemKey: string;
  /** Short machine-readable reason code, e.g. `unparseable_phone`. */
  reason: string;
  /** IDs and codes only; never personal data. */
  detail?: Record<string, string>;
};

/** What one batch did. `processed = changed + skipped.length + unchanged`. */
export type DataMigrationBatchResult = {
  processed: number;
  changed: number;
  skipped: DataMigrationSkippedItem[];
  /** Keyset cursor to continue from, or null when every item was processed. */
  nextCursor: string | null;
};

/**
 * A code-defined data migration (a backfill of existing rows). Registered in
 * `registry.ts`, run by the `DataMigration` Restate workflow in batches.
 *
 * Contract for `runBatch`:
 * - It reads at most `limit` items strictly after `cursor` in a stable keyset
 *   order (e.g. by primary key) and returns the cursor of the last item read.
 *   The cursor must never depend on what the batch wrote: a dry run rolls the
 *   writes back and continues from the same cursor.
 * - It is idempotent: re-running it over already migrated items changes
 *   nothing (they count as processed but not changed).
 * - It writes only through `db`, which is a transaction (or a savepoint in a
 *   dry run) that also records the run's checkpoint, so a batch commits
 *   atomically with its checkpoint.
 */
export type DataMigration = {
  /** Stable ID; never renamed and never reused for another migration. */
  id: string;
  /** One sentence for the admin view. */
  description: string;
  /** Items per batch (one transaction each). */
  batchSize: number;
  runBatch: (db: DatabaseExecutor, input: { cursor: string | null; limit: number }) => Promise<DataMigrationBatchResult>;
};
