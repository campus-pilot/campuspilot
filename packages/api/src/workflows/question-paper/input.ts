import { z } from 'zod';

/** The input of the control service and of the workflow: one attempt of one job. */
export const questionPaperJobInputSchema = z.object({
  jobId: z.string().regex(/^qpj_[a-z0-9]{21}$/),
  attempt: z.number().int().min(1),
});
export type QuestionPaperJobInput = z.infer<typeof questionPaperJobInputSchema>;
