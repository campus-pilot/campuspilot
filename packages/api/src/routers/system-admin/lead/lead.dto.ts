import { leadAlertStatusEnum } from '@campuspilot/db/schema/lead';
import { z } from 'zod';

import { createListInputSchema, createPaginatedOutputSchema } from '../../../paginations';

export const leadAlertStatusSchema = z.enum(leadAlertStatusEnum.enumValues);

export const listLeadsInputSchema = createListInputSchema({
  /** Matches the name, phone, WhatsApp number, email or school name answers. */
  searchQuery: z.string().trim().max(100).default(''),
  filters: z.object({ alertStatus: leadAlertStatusSchema.optional() }).optional(),
});

/**
 * One lead as platform admins read it. `response` is the stored answers JSON
 * as submitted, shown as keys and values: the admin view does not interpret
 * individual questions, so a new form question appears without code changes.
 */
export const leadDtoSchema = z.object({
  id: z.string(),
  form: z.string(),
  formVersion: z.number().int(),
  response: z.record(z.string(), z.unknown()),
  sourcePath: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.date(),
  alertStatus: leadAlertStatusSchema,
  alertHandedOverAt: z.date().nullable(),
  alertLastHandoverError: z.string().nullable(),
  alertSentAt: z.date().nullable(),
  alertError: z.string().nullable(),
});
export type LeadDto = z.infer<typeof leadDtoSchema>;

export const listLeadsOutputSchema = createPaginatedOutputSchema(leadDtoSchema);
