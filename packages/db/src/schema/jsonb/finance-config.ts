import { z } from "zod";

import { currencyCodeSchema } from "./currencies";

export const financeAmountMinorSchema = z
  .number()
  .int("Amount must be an integer number of minor currency units")
  .safe("Amount exceeds the exact JSON integer range")
  .nonnegative()
  .describe("Exact amount in the configured currency's minor units");

export const financeTimeZoneSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "Timezone must be a valid IANA timezone identifier" },
  )
  .describe("IANA timezone used to calculate local billing boundaries");

export const financeScopeEnum = z
  .enum(["school", "class", "student"])
  .describe(
    "Level at which this fee element can be configured: school-wide, per-class, or per-student",
  );

export const financeRecurringEnum = z
  .enum(["monthly", "quarterly", "yearly"])
  .describe("Billing frequency: monthly, quarterly, or yearly");

export const financeRequiredLevelEnum = z
  .enum(["school", "class", "student", "bill_generation"])
  .describe(
    "Level at which a value must be provided: school, class, student, or bill_generation (prompted at bill time)",
  );

export const financeElementSchema = z
  .object({
    name: z
      .string()
      .min(1, "Element name is required")
      .describe(
        "Display name of the fee element (e.g. 'Tuition Fee', 'Transport')",
      ),
    scopes: z
      .array(financeScopeEnum)
      .min(1, "At least one scope is required")
      .describe("Levels at which amounts can be set for this element"),
    requiredAtLevel: financeRequiredLevelEnum
      .optional()
      .describe("Level at which a value must be provided before billing"),
    defaultAmountMinor: financeAmountMinorSchema
      .optional()
      .describe(
        "Default amount in minor units if no value is set at the required level",
      ),
  })
  .describe("A fee element definition (e.g. Tuition, Transport, Lab Fee)")
  .refine(
    (element) =>
      element.defaultAmountMinor === undefined || element.requiredAtLevel != null,
    {
      message: "Default amount can only be set when requiredAtLevel is specified",
    },
  )
  .superRefine((element, context) => {
    const requiredScope = element.requiredAtLevel;
    if (
      requiredScope &&
      requiredScope !== "bill_generation" &&
      !element.scopes.includes(requiredScope)
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredAtLevel"],
        message: `Required level "${requiredScope}" must also be an allowed scope`,
      });
    }
  });

export const financeElementsSchema = z
  .record(
    z
      .string()
      .min(1)
      .describe(
        "Unique slug for the fee element (e.g. 'tuition', 'transport')",
      ),
    financeElementSchema,
  )
  .describe("Map of element slug to fee element definition");

export const financeCycleStartMonthSchema = z
  .number()
  .int()
  .min(1)
  .max(12)
  .describe("Calendar month (1-12) that anchors quarterly and yearly cycles");

const financeConfigShape = {
  recurring: financeRecurringEnum.describe(
    "Billing frequency: monthly, quarterly, or yearly",
  ),
  elements: financeElementsSchema.describe(
    "Map of element slug to fee element definition",
  ),
};

/**
 * Compatibility shape for migrated configuration whose fee facts are known
 * but whose independent currency/period facts may not be. Missing facts are
 * exposed as incomplete and must never receive inferred defaults.
 */
export const persistedFinanceSchemaConfigSchema = z
  .object({
    ...financeConfigShape,
    currency: currencyCodeSchema
      .optional()
      .describe("Explicit ISO 4217 currency code when known"),
    timeZone: financeTimeZoneSchema.optional(),
    cycleStartMonth: financeCycleStartMonthSchema.optional(),
  })
  .describe(
    "Persisted finance configuration, including migrated incomplete configuration",
  );

/** Complete configuration accepted by writes and required before billing. */
export const financeSchemaConfigSchema = z
  .object({
    ...financeConfigShape,
    currency: currencyCodeSchema.describe("Explicit ISO 4217 currency code"),
    timeZone: financeTimeZoneSchema,
    cycleStartMonth: financeCycleStartMonthSchema,
  })
  .describe(
    "School-level finance configuration defining fee structure and billing frequency",
  );

export const financeValuesMapSchema = z
  .record(
    z
      .string()
      .min(1)
      .describe("Fee element slug (must match a key in the finance schema elements)"),
    financeAmountMinorSchema.describe(
      "Exact amount in minor units for this fee element",
    ),
  )
  .describe("Map of fee element slug to amount value");

export const financeClassOverridesSchema = z
  .record(
    z
      .string()
      .min(1)
      .describe("Class slug whose finance values override session defaults"),
    financeValuesMapSchema,
  )
  .describe(
    "Map of class slug to fee element amounts overridden for that class",
  );

export const studentFinanceValuesSchema = z
  .record(
    z
      .string()
      .min(1)
      .describe("School session ID for these student-level finance values"),
    financeValuesMapSchema,
  )
  .describe(
    "Map of school session ID to fee element amounts overridden for one admission",
  );

export const financeValueScopeTypeEnum = z
  .enum(["session", "class", "student"])
  .describe(
    "Scope level: 'session' for school-wide defaults, 'class' for class overrides, 'student' for individual overrides",
  );

export type FinanceScope = z.infer<typeof financeScopeEnum>;
export type FinanceRecurring = z.infer<typeof financeRecurringEnum>;
export type FinanceRequiredLevel = z.infer<
  typeof financeRequiredLevelEnum
>;
export type FinanceElement = z.infer<typeof financeElementSchema>;
export type PersistedFinanceSchemaConfig = z.infer<
  typeof persistedFinanceSchemaConfigSchema
>;
export type FinanceSchemaConfig = z.infer<typeof financeSchemaConfigSchema>;
export type FinanceValuesMap = z.infer<typeof financeValuesMapSchema>;
export type FinanceClassOverrides = z.infer<
  typeof financeClassOverridesSchema
>;
export type StudentFinanceValuesMap = z.infer<
  typeof studentFinanceValuesSchema
>;
export type FinanceValueScopeType = z.infer<
  typeof financeValueScopeTypeEnum
>;
