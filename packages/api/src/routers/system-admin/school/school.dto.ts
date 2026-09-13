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
});

export type SchoolDto = z.infer<typeof schoolDtoSchema>;

export const listSchoolsInputSchema = createListInputSchema({
  searchQuery: z.string().trim().min(1).max(200).optional(),
  filters: z
    .object({
      hasCompletedOnboarding: z.boolean().optional(),
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
});

export const schoolIdInputSchema = z.object({ id: z.string().min(1) });

export const updateSchoolInputSchema = z
  .object({
    id: z.string().min(1),
    slug: addSchoolInputSchema.shape.slug.optional(),
    name: addSchoolInputSchema.shape.name.optional(),
    location: addSchoolInputSchema.shape.location.optional(),
    registrationNo: optionalNullableText,
    logoS3Key: optionalNullableText,
    hasCompletedOnboarding: z.boolean().optional(),
  })
  .refine(
    ({ id: _id, ...changes }) => Object.values(changes).some((value) => value !== undefined),
    { message: "At least one school field must be provided." },
  );
