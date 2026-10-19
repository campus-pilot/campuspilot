import type {
  FinanceSchemaConfig,
  FinanceValuesMap,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { randomUUID } from 'node:crypto';

/** Creates a finance configuration with admission- and class-scoped fixtures. */
export function createFinanceConfig(
  overrides: Partial<FinanceSchemaConfig> = {},
): FinanceSchemaConfig {
  return {
    recurring: overrides.recurring ?? 'monthly',
    currency: overrides.currency ?? 'INR',
    timeZone: overrides.timeZone ?? 'Asia/Kolkata',
    cycleStartMonth: overrides.cycleStartMonth ?? 4,
    elements: overrides.elements ?? {
      transport: {
        name: 'Transport',
        scopes: ['student'],
      },
      tuition: {
        name: 'Tuition',
        scopes: ['class'],
      },
    },
  };
}

/** Returns a fresh idempotency key for later posting-command test phases. */
export function createFinanceIdempotencyKey(operation: string): string {
  return `${operation}:${randomUUID()}`;
}

export const admissionFinanceValues = (
  values: FinanceValuesMap = { transport: 500 },
): FinanceValuesMap => values;
