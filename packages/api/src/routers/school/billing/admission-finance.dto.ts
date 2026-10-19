import { financeValuesMapSchema } from '@campuspilot/db/schema/jsonb/finance-config';
import { z } from 'zod';

export const admissionFinanceInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const admissionFinanceDtoSchema = admissionFinanceInputSchema.extend({
  values: financeValuesMapSchema,
});

export const updateAdmissionFinanceInputSchema =
  admissionFinanceInputSchema.extend({
    /** An empty map removes the selected session's admission override. */
    values: financeValuesMapSchema,
  });

export type AdmissionFinanceDto = z.infer<typeof admissionFinanceDtoSchema>;
