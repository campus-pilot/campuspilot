import { z } from 'zod';

/** The input of the control service and of the workflow: one lead. */
export const leadAlertInputSchema = z.object({
  leadId: z.string().regex(/^lead_[a-z0-9]{21}$/),
});
export type LeadAlertInput = z.infer<typeof leadAlertInputSchema>;
