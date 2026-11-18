import { schoolPlanSourceSchema } from "@campuspilot/db/feature-flags/catalogue";
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
   * (docs/school-billing.md). Without one it is read-only and management
   * shows a permanent warning.
   */
  hasActivePlan: z.boolean(),
  /**
   * The school has a standing tier (docs/school-billing.md), so it keeps a
   * plan when its billing periods run out; without one it is then blocked,
   * which the plan's ending notice says.
   */
  hasSubscription: z.boolean(),
  /** Where the plan comes from: `standing`, or the active period's kind (`trial`, `paid`, `complimentary`); null without a plan. */
  planSource: schoolPlanSourceSchema.nullable(),
  /**
   * When the billing periods that give the school its plan run out (ISO
   * date-time; a payment made ahead moves it); null when a standing tier
   * gives the plan or there is none. Management warns in the last days.
   */
  planEndsAt: z.iso.datetime().nullable(),
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
