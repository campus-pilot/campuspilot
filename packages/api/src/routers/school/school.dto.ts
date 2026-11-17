import { z } from "zod";

export const mySchoolDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  location: z.string(),
  logoS3Key: z.string().nullable(),
  /** Demo schools show a permanent sample-data banner in management. */
  isDemo: z.boolean(),
  /**
   * The school is suspended, so it is read-only: every change is refused
   * (docs/school-suspension.md). Management shows a permanent warning. The
   * administrator's reason is deliberately not part of this.
   */
  isSuspended: z.boolean(),
  /**
   * The school has an active plan: a subscription or an active trial
   * (docs/school-trials.md). Without one it is read-only and management
   * shows a permanent warning.
   */
  hasActivePlan: z.boolean(),
  /**
   * When the trial that gives the school its plan ends (ISO date-time);
   * null when no trial gives the plan. Management warns in the trial's last
   * days.
   */
  trialEndsAt: z.iso.datetime().nullable(),
});

export type MySchoolDto = z.infer<typeof mySchoolDtoSchema>;

export const schoolDetailsDtoSchema = mySchoolDtoSchema.extend({
  registrationNo: z.string().nullable(),
});

export type SchoolDetailsDto = z.infer<typeof schoolDetailsDtoSchema>;

export const schoolDetailsInputSchema = z.object({
  schoolId: z.string().min(1),
});

export const updateSchoolDetailsInputSchema = z
  .object({
    schoolId: z.string().min(1),
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    name: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),
    registrationNo: z.string().trim().min(1).nullable().optional(),
  })
  .refine(
    ({ schoolId: _schoolId, ...changes }) =>
      Object.values(changes).some((value) => value !== undefined),
    { message: "At least one school field must be provided." },
  );
