import { z } from "zod";

import { financeCumulativeIntegerStringSchema } from "../billing/transport";

const signedCumulativeSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/)
  .refine((value) => value.replace("-", "").length <= 38);

export const dashboardInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
});

const dashboardAdmissionsSchema = z.object({
  total: z.number().int().nonnegative(),
  registered: z.number().int().nonnegative(),
  unregistered: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  byClass: z.array(
    z.object({
      classId: z.string(),
      label: z.string(),
      value: z.number().int().nonnegative(),
    }),
  ),
});

const dashboardClassroomsSchema = z.object({
  scope: z.enum(["school", "assigned"]),
  classCount: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
  classes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      sectionCount: z.number().int().nonnegative(),
      studentCount: z.number().int().nonnegative(),
    }),
  ),
});

const dashboardExamSchema = z.object({
  slug: z.string(),
  name: z.string(),
  status: z.enum(["ready", "active", "completed"]).nullable(),
  planCount: z.number().int().nonnegative(),
  classCount: z.number().int().nonnegative(),
});

const dashboardExaminationsSchema = z.object({
  scope: z.enum(["school", "assigned"]),
  configured: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  exams: z.array(dashboardExamSchema),
});

const dashboardMonthlyFinanceSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  billedMinor: financeCumulativeIntegerStringSchema,
  paymentMinor: financeCumulativeIntegerStringSchema,
  refundMinor: financeCumulativeIntegerStringSchema,
  netCashMinor: signedCumulativeSchema,
});

const dashboardCurrencyFinanceSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  billedMinor: financeCumulativeIntegerStringSchema,
  paymentMinor: financeCumulativeIntegerStringSchema,
  refundMinor: financeCumulativeIntegerStringSchema,
  netCashMinor: signedCumulativeSchema,
  creditAdjustmentMinor: financeCumulativeIntegerStringSchema,
  debitAdjustmentMinor: financeCumulativeIntegerStringSchema,
  dueMinor: financeCumulativeIntegerStringSchema,
  collectionRateBasisPoints: financeCumulativeIntegerStringSchema.nullable(),
  billedAdmissions: z.number().int().nonnegative(),
  monthly: z.array(dashboardMonthlyFinanceSchema).max(12),
});

const dashboardBillingSchema = z.object({
  primaryCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  currencies: z.array(dashboardCurrencyFinanceSchema),
});

export const dashboardOutputSchema = z.object({
  admissions: dashboardAdmissionsSchema.nullable(),
  classrooms: dashboardClassroomsSchema.nullable(),
  billing: dashboardBillingSchema.nullable(),
  examinations: dashboardExaminationsSchema.nullable(),
  actions: z.object({
    createAdmission: z.boolean(),
    recordPayment: z.boolean(),
    enterResults: z.boolean(),
    createNotice: z.literal(false),
  }),
});

export type DashboardDto = z.infer<typeof dashboardOutputSchema>;
