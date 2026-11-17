import { schoolTierSchema } from '@campuspilot/db/feature-flags/catalogue';
import { z } from 'zod';

import { trialEndsAtSchema } from '../school/school.dto';

/**
 * One trial of a school (docs/school-trials.md). `active` is computed with
 * the database's clock when the trial is read: a trial is active while
 * `startsAt <= now < min(endsAt, endedAt)`.
 */
export const schoolTrialDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  tier: schoolTierSchema,
  startsAt: z.date(),
  /** When the trial ends by itself. */
  endsAt: z.date(),
  /** When an administrator ended it early; null otherwise. */
  endedAt: z.date().nullable(),
  active: z.boolean(),
  /** The administrator who started it; null after that account is deleted. */
  createdBy: z.string().nullable(),
  /** The administrator who ended it early; null otherwise. */
  endedBy: z.string().nullable(),
  createdAt: z.date(),
});

export type SchoolTrialDto = z.infer<typeof schoolTrialDtoSchema>;

/** The system admin router names the school `id`, like `getSchool`. */
export const startSchoolTrialInputSchema = z.object({
  id: z.string().min(1),
  tier: schoolTierSchema,
  endsAt: trialEndsAtSchema,
});

export const updateSchoolTrialInputSchema = z
  .object({
    id: z.string().min(1),
    trialId: z.string().min(1),
    tier: schoolTierSchema.optional(),
    endsAt: trialEndsAtSchema.optional(),
  })
  .refine(({ tier, endsAt }) => tier !== undefined || endsAt !== undefined, {
    message: 'Give the trial a new tier or a new end.',
  });

export const endSchoolTrialInputSchema = z.object({
  id: z.string().min(1),
  trialId: z.string().min(1),
});
