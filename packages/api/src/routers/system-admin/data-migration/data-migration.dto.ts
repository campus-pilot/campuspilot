import { z } from 'zod';

export const dataMigrationRunDtoSchema = z.object({
  id: z.string(),
  migrationId: z.string(),
  dryRun: z.boolean(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  /** Null when the API server registered the run on boot. */
  requestedBy: z.string().nullable(),
  requestedAt: z.date(),
  submittedAt: z.date().nullable(),
  lastSubmitError: z.string().nullable(),
  batchCount: z.number().int(),
  processedCount: z.number().int(),
  changedCount: z.number().int(),
  skippedCount: z.number().int(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  error: z.string().nullable(),
});

export type DataMigrationRunDto = z.infer<typeof dataMigrationRunDtoSchema>;

export const dataMigrationDtoSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** Most recent runs first (at most five). */
  runs: z.array(dataMigrationRunDtoSchema),
});

export const listDataMigrationsOutputSchema = z.object({
  items: z.array(dataMigrationDtoSchema),
});

export const requestDataMigrationRunInputSchema = z.object({
  migrationId: z.string().min(1).max(200),
  dryRun: z.boolean(),
});

export const listDataMigrationSkippedItemsInputSchema = z.object({
  runId: z.string().regex(/^dmr_[a-z0-9]{21}$/),
  /** Keyset cursor: the last item key of the previous page. */
  after: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listDataMigrationSkippedItemsOutputSchema = z.object({
  items: z.array(z.object({
    itemKey: z.string(),
    reason: z.string(),
    detail: z.record(z.string(), z.string()).nullable(),
  })),
  /** Pass as `after` for the next page; null on the last page. */
  nextAfter: z.string().nullable(),
});
