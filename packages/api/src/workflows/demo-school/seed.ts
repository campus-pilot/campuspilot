import { roleEnum } from '@campuspilot/db/schema/jsonb/role';
import { currencyCodeSchema } from '@campuspilot/db/schema/jsonb/currencies';
import {
  financeElementsSchema,
  financeRecurringEnum,
  financeTimeZoneSchema,
} from '@campuspilot/db/schema/jsonb/finance-config';
import {
  coScholasticAreasSchema,
  gradingScaleSchema,
} from '@campuspilot/db/schema/jsonb/session-config';
import { examModesSchema } from '@campuspilot/db/schema/jsonb/class-config';
import { z } from 'zod';

import classesJson from './seed/classes.json';
import financeJson from './seed/finance.json';
import peopleJson from './seed/people.json';
import sessionJson from './seed/session.json';
import staffJson from './seed/staff.json';

/**
 * Committed, fully synthetic demo seed data. Nothing here may be copied from a
 * real or imported school (AGENTS.md "Demo schools"). Every file is validated
 * once at load time so a malformed edit fails fast in tests, not mid-seed.
 */

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const minorSchema = z.number().int().nonnegative();
const shareSchema = z.number().min(0).max(1);

const classesSeedSchema = z
  .object({
    subjectSets: z.record(
      z.string(),
      z.record(slugSchema, z.object({ name: z.string().min(1), book: z.string().min(1), modes: z.string().min(1) })),
    ),
    examModeSets: z.record(z.string(), examModesSchema),
    bookPublication: z.string().min(1),
    classes: z
      .array(
        z.object({
          slug: slugSchema,
          label: z.string().min(1),
          subjectSet: z.string().min(1),
          ageAtSessionStart: z.number().int().min(2).max(18),
          tuitionMinor: minorSchema,
          smartClassMinor: minorSchema,
        }),
      )
      .min(1),
  })
  .superRefine((value, context) => {
    for (const [setName, subjects] of Object.entries(value.subjectSets)) {
      for (const [subject, definition] of Object.entries(subjects)) {
        if (!value.examModeSets[definition.modes]) {
          context.addIssue({ code: 'custom', path: ['subjectSets', setName, subject], message: `Unknown exam mode set ${definition.modes}` });
        }
      }
    }
    for (const [index, item] of value.classes.entries()) {
      if (!value.subjectSets[item.subjectSet]) {
        context.addIssue({ code: 'custom', path: ['classes', index, 'subjectSet'], message: `Unknown subject set ${item.subjectSet}` });
      }
    }
    if (new Set(value.classes.map(({ slug }) => slug)).size !== value.classes.length) {
      context.addIssue({ code: 'custom', path: ['classes'], message: 'Class slugs must be unique' });
    }
  });

const sessionSeedSchema = z.object({
  exams: z
    .array(
      z.object({
        slug: slugSchema,
        name: z.string().min(1),
        order: z.number().int().min(1),
        /** Months after the session start month in which the exam window opens. */
        monthOffset: z.number().int().min(0).max(11),
        startDay: z.number().int().min(1).max(20),
        /** Timetable slots, two per exam day. */
        slots: z.number().int().min(2).max(20),
        /** Whether the exam's month bills the examination fee; short tests do not. */
        chargesFee: z.boolean(),
      }),
    )
    .min(1),
  /** An exam stays `active` (marks being entered) this many days after its window. */
  activeWithinDaysAfterWindow: z.number().int().nonnegative(),
  gradingScale: gradingScaleSchema,
  coScholasticAreas: coScholasticAreasSchema,
  coScholasticGrades: z.array(z.string().min(1)).min(1),
  attendanceTracking: z.object({ enabled: z.boolean() }),
  /** School-level Cadet Portal settings a demo starts with. */
  cadetPortal: z.object({ showClassAverages: z.boolean() }),
  /** Teacher remarks by result band; `{firstName}` is replaced with the student's first name. */
  remarks: z.object({
    high: z.array(z.string().min(1).max(1000)).min(1),
    mid: z.array(z.string().min(1).max(1000)).min(1),
    low: z.array(z.string().min(1).max(1000)).min(1),
  }),
  admissionDocumentTypes: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
});

const financeSeedSchema = z.object({
  currency: currencyCodeSchema,
  timeZone: financeTimeZoneSchema,
  recurring: financeRecurringEnum,
  elements: financeElementsSchema,
  examinationFeeElement: z.string().min(1),
  examinationFeeMinor: minorSchema,
  transport: z.object({ element: z.string().min(1), share: shareSchema, amountsMinor: z.array(minorSchema).min(1) }),
  paymentProfiles: z
    .array(z.object({ kind: z.enum(['punctual', 'late', 'partial', 'defaulter', 'advance']), share: shareSchema }))
    .min(1),
  paymentMethods: z
    .array(z.object({ method: z.enum(['cash', 'bank_transfer', 'card', 'cheque']), weight: z.number().int().positive() }))
    .min(1),
  discounts: z.object({
    share: shareSchema,
    reasons: z
      .array(
        z.object({
          code: z.string().min(1),
          note: z.string().min(1),
          calculation: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('fixed'), amountMinor: z.number().int().positive() }),
            z.object({ kind: z.literal('percentage'), percentage: z.string().regex(/^\d{1,2}(\.\d{1,4})?$/) }),
          ]),
        }),
      )
      .min(1),
    paymentDiscountShare: shareSchema,
    paymentDiscount: z.object({ code: z.string().min(1), note: z.string().min(1), amountMinor: z.number().int().positive() }),
  }),
  unregisterShare: shareSchema,
});

const nameListSchema = z.array(z.string().min(1)).min(10);
const peopleSeedSchema = z.object({
  childFirstNames: z.object({ female: nameListSchema, male: nameListSchema }),
  adultFirstNames: z.object({ female: nameListSchema, male: nameListSchema }),
  surnames: nameListSchema,
  staffTitles: z.object({ female: z.string().min(1), male: z.string().min(1) }),
  streets: z.array(z.string().min(1)).min(1),
  localities: z.array(z.string().min(1)).min(1),
  sampleCity: z.string().min(1),
  postalCodePrefix: z.string().regex(/^\d{3}$/),
  /**
   * First five digits of every demo phone number (the rest is random). Demo
   * numbers must pass phone validation (E.164, read as Indian numbers), so
   * the old all-zero prefix no longer works; `55555` is outside the Indian
   * mobile ranges (6–9), so a demo number cannot reach a real WhatsApp user.
   */
  phonePrefix: z.string().regex(/^5\d{4}$/),
});

const staffRoleSchema = z.object({
  role: roleEnum,
  /** The role segment of `{emailRole}.{slug}@{emailDomain}`. */
  emailRole: slugSchema,
  label: z.string().min(1),
});
const staffSeedSchema = z.object({
  singleHolders: z.array(staffRoleSchema).min(1),
  teacher: staffRoleSchema,
  emailDomain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
});

export const demoSeed = {
  classes: classesSeedSchema.parse(classesJson),
  session: sessionSeedSchema.parse(sessionJson),
  finance: financeSeedSchema
    .superRefine((value, context) => {
      const total = value.paymentProfiles.reduce((sum, profile) => sum + profile.share, 0);
      if (Math.abs(total - 1) > 1e-9) context.addIssue({ code: 'custom', path: ['paymentProfiles'], message: 'Profile shares must add up to 1' });
      for (const key of [value.examinationFeeElement, value.transport.element]) {
        if (!value.elements[key]) context.addIssue({ code: 'custom', path: ['elements'], message: `Unknown element ${key}` });
      }
    })
    .parse(financeJson),
  people: peopleSeedSchema.parse(peopleJson),
  staff: staffSeedSchema.parse(staffJson),
};

export type DemoSeed = typeof demoSeed;
export type DemoClassSeed = DemoSeed['classes']['classes'][number];

/** The class catalogue shown by the demo dialog, in display order. */
export function demoClassCatalogue() {
  return demoSeed.classes.classes.map(({ slug, label }, index) => ({
    slug,
    label,
    displayOrder: index + 1,
  }));
}
