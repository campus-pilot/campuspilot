import { z } from "zod";

import { currencyCodeSchema } from "./currencies";

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
    defaultValue: z
      .number()
      .nonnegative()
      .optional()
      .describe("Default amount if no value is set at the required level"),
  })
  .describe("A fee element definition (e.g. Tuition, Transport, Lab Fee)")
  .refine(
    (element) =>
      element.defaultValue === undefined || element.requiredAtLevel != null,
    {
      message: "Default value can only be set when requiredAtLevel is specified",
    },
  );

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

export const financeSchemaConfigSchema = z
  .object({
    recurring: financeRecurringEnum.describe(
      "Billing frequency: monthly, quarterly, or yearly",
    ),
    currency: currencyCodeSchema
      .default("INR")
      .describe("ISO 4217 currency code (default: INR)"),
    elements: financeElementsSchema.describe(
      "Map of element slug to fee element definition",
    ),
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
    z.number().nonnegative().describe("Amount for this fee element"),
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
export type FinanceSchemaConfig = z.infer<typeof financeSchemaConfigSchema>;
export type FinanceValuesMap = z.infer<typeof financeValuesMapSchema>;
export type FinanceClassOverrides = z.infer<
  typeof financeClassOverridesSchema
>;
export type FinanceValueScopeType = z.infer<
  typeof financeValueScopeTypeEnum
>;
