import { z } from 'zod';

/** The input of the control service and of the runner: one job. */
export const documentGenerationJobInputSchema = z.object({
  jobId: z.string().regex(/^dgj_[a-z0-9]{21}$/),
});
export type DocumentGenerationJobInput = z.infer<typeof documentGenerationJobInputSchema>;
