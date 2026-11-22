import { billingPeriodKindSchema, resolveSchoolPlan, schoolPlanSourceSchema, schoolTierSchema } from "@campuspilot/db/feature-flags/catalogue";
import type { ActiveBillingPeriod } from "@campuspilot/db/feature-flags/store";
import type { schoolTable } from "@campuspilot/db/schema/school";
import { SCHOOL_KINDS } from "@campuspilot/db/school-kind";
import { z } from "zod";

import { createListInputSchema, createPaginatedOutputSchema } from "../../../paginations";

/** A school's active billing period as the admin app shows it next to the school; `endsAt` is when it really ends. */
export const activeBillingPeriodDtoSchema = z.object({
  id: z.string(),
  kind: billingPeriodKindSchema,
  tier: schoolTierSchema,
  startsAt: z.date(),
  endsAt: z.date(),
});

export const schoolDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  location: z.string(),
  registrationNo: z.string().nullable(),
  logoS3Key: z.string().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  hasCompletedOnboarding: z.boolean(),
  /** Explicit demo fact (`school.is_demo`); never inferred from slug or email. */
  isDemo: z.boolean(),
  /** A real school or a person's personal space (`school.kind`, docs/personal-space.md). */
  kind: z.enum(SCHOOL_KINDS),
  /** `school.tier`: the school's standing tier, which never lapses; null without one (docs/school-billing.md). */
  subscribedTier: schoolTierSchema.nullable(),
  /**
   * The tier of the school's plan, which its features follow: the higher of
   * the standing tier and the active billing period (docs/school-billing.md). Null
   * when the school has no plan, which makes it read-only.
   */
  planTier: schoolTierSchema.nullable(),
  /** Which of the two gives `planTier`; null when the school has no plan. */
  planSource: schoolPlanSourceSchema.nullable(),
  /** The active billing period, whether or not it gives the plan; null without one. */
  period: activeBillingPeriodDtoSchema.nullable(),
  /**
   * When the school was suspended; null while it is not. A suspended
   * school is read-only for its staff and students
   * (docs/school-suspension.md).
   */
  suspendedAt: z.date().nullable(),
  /** Why it is suspended, as the administrator wrote it; null while it is not suspended. */
  suspendedReason: z.string().nullable(),
  /**
   * The school's owner (docs/school-creation.md): the person who created it
   * themselves, or whom an administrator named; null when it has none.
   */
  ownerUserId: z.string().nullable(),
});

export type SchoolDto = z.infer<typeof schoolDtoSchema>;

export const listSchoolsInputSchema = createListInputSchema({
  searchQuery: z.string().trim().min(1).max(200).optional(),
  filters: z
    .object({
      hasCompletedOnboarding: z.boolean().optional(),
      /** Schools subscribed to one tier, or null for schools without a subscription. */
      subscribedTier: schoolTierSchema.nullable().optional(),
      /** True for suspended schools only, false for schools that are not. */
      suspended: z.boolean().optional(),
      /**
       * The plan state: `trial`, `paid` or `complimentary` for schools in an
       * active billing period of that kind (whether or not it gives their
       * plan), `none` for schools without a plan (no standing tier and no
       * active period).
       */
      plan: z.enum(["trial", "paid", "complimentary", "none"]).optional(),
      /** Real schools (`school`) or personal spaces (`personal`) only. */
      kind: z.enum(SCHOOL_KINDS).optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(["name", "location", "createdAt", "updatedAt"]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "name", direction: "asc" }),
});

export const listSchoolsOutputSchema = createPaginatedOutputSchema(schoolDtoSchema);

/**
 * A school row with its active billing period (null without one) as the admin DTO,
 * with the plan both give (`resolveSchoolPlan`).
 */
export function toSchoolDto(row: typeof schoolTable.$inferSelect, activePeriod: ActiveBillingPeriod | null): SchoolDto {
  const { tier, ...school } = row;
  const plan = resolveSchoolPlan({ subscribedTier: tier, activePeriod });
  return schoolDtoSchema.parse({
    ...school,
    subscribedTier: tier,
    planTier: plan.tier,
    planSource: plan.source,
    period: activePeriod,
  });
}

const optionalNullableText = z.string().trim().min(1).nullable().optional();

/**
 * When a trial ends, as an ISO date-time with its offset. It must lie in the
 * future (checked by the handler against the server's clock) and at most
 * {@link MAX_TRIAL_DAYS} days ahead.
 */
export const trialEndsAtSchema = z.iso.datetime({ offset: true }).describe("When the trial ends (ISO 8601 with offset)");

/**
 * The longest a trial may run from now. A guard against a mistyped year in
 * the end date; a school that needs longer is a subscription. 367, not 366:
 * twelve calendar months that span 29 February end 366 days and most of a day
 * from now (the end is the last second of a day in IST).
 */
export const MAX_TRIAL_DAYS = 367;

export const addSchoolInputSchema = z.object({
  slug: z.string().trim().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  location: z.string().trim().min(1),
  registrationNo: optionalNullableText,
  logoS3Key: optionalNullableText,
  /**
   * The tier the school subscribes to (`subscribedTier` of the result); null
   * or left out for none. A school created without a subscription and
   * without `trial` has no plan and is read-only until it gets one.
   */
  tier: schoolTierSchema.nullable().optional(),
  /** A trial started with the school, in the same transaction; null or left out for none. */
  trial: z
    .object({
      tier: schoolTierSchema,
      endsAt: trialEndsAtSchema,
    })
    .nullable()
    .optional(),
});

/** Why the school is suspended, for platform administrators only. */
export const suspendSchoolInputSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
});

export const schoolIdInputSchema = z.object({ id: z.string().min(1) });

/**
 * Names the school's owner, or clears it with null. The new owner must be a
 * member holding the principal role (docs/school-creation.md).
 */
export const updateSchoolOwnerInputSchema = z.object({
  id: z.string().min(1),
  ownerUserId: z.string().min(1).nullable(),
});

export const updateSchoolInputSchema = z
  .object({
    id: z.string().min(1),
    slug: addSchoolInputSchema.shape.slug.optional(),
    name: addSchoolInputSchema.shape.name.optional(),
    location: addSchoolInputSchema.shape.location.optional(),
    registrationNo: optionalNullableText,
    // No `logoS3Key`: the logo upload handler is the only writer of a
    // school's logo key, so it always points under `schools/{id}/logo/`.
    // An arbitrary key would let a later demo purge target foreign objects.
    hasCompletedOnboarding: z.boolean().optional(),
  })
  .refine(
    ({ id: _id, ...changes }) => Object.values(changes).some((value) => value !== undefined),
    { message: "At least one school field must be provided." },
  );
