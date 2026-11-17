import { schoolTierSchema } from "@campuspilot/db/feature-flags/catalogue";
import { z } from "zod";

import { createListInputSchema, createPaginatedOutputSchema } from "../../../paginations";

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
  /** The school's subscription tier, which decides the features it has; null when it has none. */
  tier: schoolTierSchema.nullable(),
  /**
   * When the school was suspended; null while it is not. A suspended
   * school is read-only for its staff and students
   * (docs/school-suspension.md).
   */
  suspendedAt: z.date().nullable(),
  /** Why it is suspended, as the administrator wrote it; null while it is not suspended. */
  suspendedReason: z.string().nullable(),
});

export type SchoolDto = z.infer<typeof schoolDtoSchema>;

export const listSchoolsInputSchema = createListInputSchema({
  searchQuery: z.string().trim().min(1).max(200).optional(),
  filters: z
    .object({
      hasCompletedOnboarding: z.boolean().optional(),
      /** One tier's schools, or null for schools without a subscribed tier. */
      tier: schoolTierSchema.nullable().optional(),
      /** True for suspended schools only, false for schools that are not. */
      suspended: z.boolean().optional(),
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

export function toSchoolDto(value: SchoolDto): SchoolDto {
  return schoolDtoSchema.parse(value);
}

const optionalNullableText = z.string().trim().min(1).nullable().optional();

export const addSchoolInputSchema = z.object({
  slug: z.string().trim().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  location: z.string().trim().min(1),
  registrationNo: optionalNullableText,
  logoS3Key: optionalNullableText,
  /** Stated for every new school: there is no default tier. */
  tier: schoolTierSchema,
});

/** Why the school is suspended, for platform administrators only. */
export const suspendSchoolInputSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
});

export const schoolIdInputSchema = z.object({ id: z.string().min(1) });

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
