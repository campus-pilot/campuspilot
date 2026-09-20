import {
  financeClassOverridesSchema,
  financeSchemaConfigSchema,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { z } from 'zod';

export const schoolSessionFinanceInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const sessionFinanceClassDtoSchema = z.object({
  slug: z.string().min(1),
  label: z.string().min(1),
});

export const schoolSessionFinanceDtoSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  financeConfig: financeSchemaConfigSchema.nullable(),
  classOverrides: financeClassOverridesSchema,
  classes: z.array(sessionFinanceClassDtoSchema),
});

export const updateSchoolSessionFinanceInputSchema =
  schoolSessionFinanceInputSchema
    .extend({
      financeConfig: financeSchemaConfigSchema.nullable().optional(),
      classOverrides: financeClassOverridesSchema.optional(),
    })
    .refine(
      ({ financeConfig, classOverrides }) =>
        financeConfig !== undefined || classOverrides !== undefined,
      { message: 'At least one finance field must be provided.' },
    );

export type SchoolSessionFinanceDto = z.infer<
  typeof schoolSessionFinanceDtoSchema
>;
