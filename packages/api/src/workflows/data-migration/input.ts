import { z } from 'zod';

/** Input of `DataMigrationControl.start` and the `DataMigration` workflow; parsed before any journal entry. */
export const dataMigrationRunInputSchema = z.object({
  runId: z.string().regex(/^dmr_[a-z0-9]{21}$/),
});

export type DataMigrationRunInput = z.infer<typeof dataMigrationRunInputSchema>;
