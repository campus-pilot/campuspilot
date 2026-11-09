import { z } from 'zod';

import { createListInputSchema, createPaginatedOutputSchema } from '../../paginations';

/**
 * DTOs of the Cadet Portal. They are deliberately narrower than the staff
 * DTOs: a student sees their own facts in plain terms, never staff-only
 * metadata such as recorder ids, idempotency keys or internal notes.
 */

/**
 * A class average (overall or for one subject) is shown only when at least
 * this many students have results in it. With fewer, an average would let a
 * student work out a classmate's marks (in a class of two, the average and
 * your own mark give the other mark exactly), so the portal shows none.
 */
export const CADET_CLASS_AVERAGE_MIN_STUDENTS = 5;

const minorSchema = z.string().regex(/^-?(0|[1-9]\d*)$/);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

// ---------------------------------------------------------------------------
// Profile

export const cadetEnrollmentSchema = z.object({
  /** The student row (one session's enrollment). */
  studentId: z.string(),
  sessionId: z.string(),
  sessionLabel: z.string(),
  /** True for the school's active session; it is the session's own flag, not a date. */
  sessionIsActive: z.boolean(),
  classLabel: z.string().nullable(),
  sectionLabel: z.string().nullable(),
  rollNo: z.number().int().nullable(),
});

export const cadetProfileSchema = z.object({
  name: z.string(),
  admissionNo: z.string(),
  schoolName: z.string(),
  /** Newest session first. */
  enrollments: z.array(cadetEnrollmentSchema),
});
export type CadetProfileDto = z.infer<typeof cadetProfileSchema>;

// ---------------------------------------------------------------------------
// Fees

export const cadetFeeSummarySchema = z.object({
  /** Lifetime totals of the student's account, one row per currency. */
  currencies: z.array(
    z.object({
      currency: currencySchema,
      /** Debits minus credits; positive is owed, negative is in credit. */
      balanceMinor: minorSchema,
      dueMinor: minorSchema,
      creditMinor: minorSchema,
      billedMinor: minorSchema,
      paidMinor: minorSchema,
      /** Discounts, waivers, write-offs and credit corrections. */
      concessionsMinor: minorSchema,
      refundedMinor: minorSchema,
    }),
  ),
});
export type CadetFeeSummaryDto = z.infer<typeof cadetFeeSummarySchema>;

const ledgerTypeSchema = z.enum([
  'bill',
  'manual_debit_adjustment',
  'payment',
  'discount',
  'waiver',
  'write_off',
  'refund',
  'debit_correction',
  'credit_correction',
  'reversal',
]);

export const listCadetFeeLedgerInputSchema = createListInputSchema({});

export const cadetLedgerEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: ledgerTypeSchema,
  direction: z.enum(['debit', 'credit']),
  amountMinor: minorSchema,
  currency: currencySchema,
  effectiveAt: z.date(),
  /** The session's finance time zone, for showing the local date; null for legacy sessions. */
  timeZone: z.string().nullable(),
  /** Account balance after this entry, in this currency. */
  runningBalanceMinor: minorSchema,
  /** True when a later entry reversed this one. */
  reversed: z.boolean(),
  /** Bill, receipt or refund number when the entry has one. */
  reference: z.string().nullable(),
  /** Set on bill entries so the portal can open the bill. */
  billId: z.string().nullable(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'other']).nullable(),
});
export type CadetLedgerEntryDto = z.infer<typeof cadetLedgerEntrySchema>;
export const listCadetFeeLedgerOutputSchema = createPaginatedOutputSchema(cadetLedgerEntrySchema);

export const getCadetBillInputSchema = z.object({
  billId: z.string().min(1).describe('A bill id from listFeeLedger (billId).'),
});

export const cadetBillSchema = z.object({
  id: z.string(),
  billNumber: z.string(),
  issueDate: z.string(),
  /** Billing period key such as `monthly:2026-11`; null for manual bills. */
  periodKey: z.string().nullable(),
  sessionLabel: z.string(),
  classLabel: z.string().nullable(),
  sectionLabel: z.string().nullable(),
  currency: currencySchema,
  totalAmountMinor: minorSchema,
  /** Debit corrections added to this bill. */
  addedMinor: minorSchema,
  /** Concessions applied to this bill (discounts, waivers, write-offs, credit corrections). */
  concessionsMinor: minorSchema,
  /** Total plus additions minus concessions, never below zero. */
  netAmountMinor: minorSchema,
  reversed: z.boolean(),
  lines: z.array(z.object({ id: z.string(), name: z.string(), amountMinor: minorSchema })),
  adjustments: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['discount', 'waiver', 'write_off', 'debit_correction', 'credit_correction']),
      amountMinor: minorSchema,
      recordedAt: z.date(),
      reversed: z.boolean(),
    }),
  ),
});
export type CadetBillDto = z.infer<typeof cadetBillSchema>;

// ---------------------------------------------------------------------------
// Results

/**
 * Why an examination does or does not show results to the student. Each value
 * comes from explicit facts: no plans for the class or a `ready` exam is
 * `upcoming`, `active` is `in_progress`, `completed` without a Cadet release
 * is `awaiting_release`, and only an explicit release is `released`.
 */
export const cadetExamStateSchema = z.enum(['upcoming', 'in_progress', 'awaiting_release', 'released']);
export type CadetExamState = z.infer<typeof cadetExamStateSchema>;

export const listCadetExamsInputSchema = createListInputSchema({
  filters: z
    .object({
      recordId: z
        .string()
        .min(1)
        .optional()
        .describe('A class record id from getGrowth (classes[].recordId). Defaults to the current class.'),
    })
    .optional(),
});

export const cadetExamListItemSchema = z.object({
  /** Opaque id for getExamResult: one examination in one class record. */
  examId: z.string(),
  recordId: z.string(),
  examSlug: z.string(),
  name: z.string(),
  order: z.number().int(),
  state: cadetExamStateSchema,
  releasedAt: z.date().nullable(),
  /** Only for released exams the student has marks in. */
  percentage: z.number().nullable(),
  grade: z.string().nullable(),
});
export type CadetExamListItemDto = z.infer<typeof cadetExamListItemSchema>;
export const listCadetExamsOutputSchema = createPaginatedOutputSchema(cadetExamListItemSchema).extend({
  /** The class record listed; null when the student has no class yet. */
  record: z
    .object({ recordId: z.string(), classLabel: z.string(), sectionLabel: z.string().nullable(), sessionLabel: z.string() })
    .nullable(),
});

export const getCadetExamResultInputSchema = z.object({
  examId: z.string().min(1).describe('An examId from listExams.'),
});

export const cadetRemarkSchema = z.object({
  text: z.string(),
  authorName: z.string().nullable(),
  updatedAt: z.date(),
});

export const cadetExamResultSchema = z.object({
  examId: z.string(),
  recordId: z.string(),
  name: z.string(),
  sessionLabel: z.string(),
  classLabel: z.string(),
  sectionLabel: z.string().nullable(),
  releasedAt: z.date(),
  /** Null when the student has no marks in this exam. */
  overall: z
    .object({ obtained: z.number(), max: z.number(), percentage: z.number(), grade: z.string().nullable() })
    .nullable(),
  /** The previous released exam of the same class the student has marks in. */
  previousExam: z.object({ examId: z.string(), name: z.string(), percentage: z.number() }).nullable(),
  /** Null unless the school shares class averages. */
  classAveragePercentage: z.number().nullable(),
  attendance: z.object({ daysAttended: z.number().int(), totalWorkingDays: z.number().int() }).nullable(),
  subjects: z.array(
    z.object({
      /** Scoped to this class record: the same slug in another class is a different subject. */
      subjectId: z.string(),
      name: z.string(),
      obtained: z.number(),
      max: z.number(),
      percentage: z.number(),
      grade: z.string().nullable(),
      modes: z.array(z.object({ name: z.string(), obtained: z.number(), max: z.number() })),
      /** Same subject in `previousExam`; null when absent. */
      previousPercentage: z.number().nullable(),
      classAveragePercentage: z.number().nullable(),
    }),
  ),
  coScholastics: z.array(z.object({ area: z.string(), grade: z.string() })),
  remark: cadetRemarkSchema.nullable(),
});
export type CadetExamResultDto = z.infer<typeof cadetExamResultSchema>;

export const getCadetGrowthInputSchema = z.object({
  recordId: z
    .string()
    .min(1)
    .optional()
    .describe('A class record id from classes[].recordId. Defaults to the current class.'),
});

export const cadetClassRecordSchema = z.object({
  /** One class in one session's enrollment. */
  recordId: z.string(),
  classLabel: z.string(),
  sectionLabel: z.string().nullable(),
  sessionLabel: z.string(),
  sessionIsActive: z.boolean(),
  /** The latest released exam the student has marks in, for "class by class". */
  latest: z
    .object({ examName: z.string(), percentage: z.number(), classAveragePercentage: z.number().nullable() })
    .nullable(),
});

export const cadetGrowthSchema = z.object({
  /** Every class the student's profile was in, newest session first. */
  classes: z.array(cadetClassRecordSchema),
  /** The selected class; null when the student has none. */
  selected: z
    .object({
      recordId: z.string(),
      /** Subjects of this class only, with ids scoped to the record. */
      subjects: z.array(z.object({ subjectId: z.string(), name: z.string() })),
      /** Released exams with the student's marks, oldest first. */
      exams: z.array(
        z.object({
          examId: z.string(),
          name: z.string(),
          percentage: z.number(),
          classAveragePercentage: z.number().nullable(),
          /** Percent per subjectId. */
          subjects: z.record(z.string(), z.number()),
          /** Class average percent per subjectId; null unless the school shares averages. */
          subjectAverages: z.record(z.string(), z.number()).nullable(),
        }),
      ),
    })
    .nullable(),
  /** Whether the school shares class averages (the server already omits them when false). */
  classAveragesShared: z.boolean(),
});
export type CadetGrowthDto = z.infer<typeof cadetGrowthSchema>;

export const listCadetRemarksInputSchema = createListInputSchema({
  filters: z
    .object({
      recordId: z.string().min(1).optional().describe('Only remarks of this class record.'),
    })
    .optional(),
});
export const cadetRemarkListItemSchema = cadetRemarkSchema.extend({
  examId: z.string(),
  examName: z.string(),
  recordId: z.string(),
});
export const listCadetRemarksOutputSchema = createPaginatedOutputSchema(cadetRemarkListItemSchema);
