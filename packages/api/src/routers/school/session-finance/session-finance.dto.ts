import {
  financeClassOverridesSchema,
  persistedFinanceSchemaConfigSchema,
  financeSchemaConfigSchema,
  type PersistedFinanceSchemaConfig,
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

export const financeConfigurationMissingFieldSchema = z.enum([
  'currency',
  'timeZone',
  'cycleStartMonth',
]);

export const financeConfigurationReadinessSchema = z.object({
  status: z.enum(['not_configured', 'incomplete', 'ready']),
  readyForBilling: z.boolean(),
  missingFields: z.array(financeConfigurationMissingFieldSchema),
});

/**
 * Billing cannot use migrated configuration until each independent missing
 * fact is explicitly supplied. This function never derives one from another.
 */
export function getFinanceConfigurationReadiness(
  financeConfig: PersistedFinanceSchemaConfig | null,
): z.infer<typeof financeConfigurationReadinessSchema> {
  const missingFields: Array<
    z.infer<typeof financeConfigurationMissingFieldSchema>
  > = [];
  if (!financeConfig?.currency) missingFields.push('currency');
  if (!financeConfig?.timeZone) missingFields.push('timeZone');
  if (!financeConfig?.cycleStartMonth) missingFields.push('cycleStartMonth');

  if (!financeConfig) {
    return {
      status: 'not_configured',
      readyForBilling: false,
      missingFields,
    };
  }
  return {
    status: missingFields.length === 0 ? 'ready' : 'incomplete',
    readyForBilling: missingFields.length === 0,
    missingFields,
  };
}

export const schoolSessionFinanceDtoSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  financeConfig: persistedFinanceSchemaConfigSchema.nullable(),
  configurationReadiness: financeConfigurationReadinessSchema,
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
