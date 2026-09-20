import { z } from "zod";

export const mySchoolDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  location: z.string(),
  logoS3Key: z.string().nullable(),
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
