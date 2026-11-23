import { z } from 'zod';

/** The input of the control service and of the workflow: one lead. */
export const leadAlertInputSchema = z.object({
  leadId: z.string().regex(/^lead_[a-z0-9]{21}$/),
});
export type LeadAlertInput = z.infer<typeof leadAlertInputSchema>;

/** The input of the School Onboarding alert: one submission. */
export const schoolOnboardingAlertInputSchema = z.object({
  requestId: z.string().regex(/^srreq_[a-z0-9]{21}$/),
});
export type SchoolOnboardingAlertInput = z.infer<typeof schoolOnboardingAlertInputSchema>;
