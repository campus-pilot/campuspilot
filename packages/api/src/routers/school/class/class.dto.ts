import { attributesSchema } from "@campuspilot/db/schema/jsonb/attributes";
import { classConfigSchema } from "@campuspilot/db/schema/jsonb/class-config";
import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must contain lowercase letters, numbers, and single hyphens only",
  );

const labelSchema = z.string().trim().min(1, "Label is required").max(200);

export const classDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  displayOrder: z.number().int().positive(),
  schoolId: z.string(),
  attributes: attributesSchema,
  config: classConfigSchema,
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const sectionDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  displayOrder: z.number().int().positive(),
  classId: z.string(),
  schoolId: z.string(),
  attributes: attributesSchema,
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type ClassDto = z.infer<typeof classDtoSchema>;
export type SectionDto = z.infer<typeof sectionDtoSchema>;

export const classSummaryDtoSchema = classDtoSchema.extend({
  sectionCount: z.number().int().nonnegative(),
  teacherCount: z.number().int().nonnegative(),
  // Student membership is not modeled yet; null keeps that absence explicit.
  studentCount: z.number().int().nonnegative().nullable(),
  subjectCount: z.number().int().nonnegative(),
});

export function toClassDto(value: ClassDto): ClassDto {
  return classDtoSchema.parse(value);
}

export function toSectionDto(value: SectionDto): SectionDto {
  return sectionDtoSchema.parse(value);
}

export const listClassesInputSchema = z.object({
  schoolId: z.string().min(1),
});

export const listClassesOutputSchema = z.array(classSummaryDtoSchema);

export const classIdInputSchema = z.object({
  schoolId: z.string().min(1),
  classId: z.string().min(1),
});

const initialSectionSchema = z.object({
  slug: slugSchema,
  label: labelSchema,
  attributes: attributesSchema.optional(),
});

export const createClassInputSchema = z.object({
  schoolId: z.string().min(1),
  slug: slugSchema,
  label: labelSchema,
  attributes: attributesSchema.optional(),
  config: classConfigSchema.optional(),
  sections: z
    .array(initialSectionSchema)
    .min(1, "A class must have at least one section"),
});

export const updateClassInputSchema = classIdInputSchema
  .extend({
    slug: slugSchema.optional(),
    label: labelSchema.optional(),
  })
  .refine(({ slug, label }) => slug !== undefined || label !== undefined, {
    message: "At least one class field must be provided.",
  });

export const updateClassConfigurationInputSchema = classIdInputSchema
  .extend({
    attributes: attributesSchema.optional(),
    config: classConfigSchema.optional(),
  })
  .refine(
    ({ attributes, config }) =>
      attributes !== undefined || config !== undefined,
    { message: "Attributes or config must be provided." },
  );

export const listSectionsInputSchema = z.object({
  schoolId: z.string().min(1),
  classId: z.string().min(1),
});

export const listSectionsOutputSchema = z.array(sectionDtoSchema);

export const sectionIdInputSchema = classIdInputSchema.extend({
  sectionId: z.string().min(1),
});

export const createSectionInputSchema = classIdInputSchema.extend({
  slug: slugSchema,
  label: labelSchema,
  attributes: attributesSchema.optional(),
});

export const updateSectionInputSchema = sectionIdInputSchema
  .extend({
    slug: slugSchema.optional(),
    label: labelSchema.optional(),
  })
  .refine(({ slug, label }) => slug !== undefined || label !== undefined, {
    message: "At least one section field must be provided.",
  });

export const updateSectionAttributesInputSchema = sectionIdInputSchema.extend({
  attributes: attributesSchema,
});

function uniqueIds(values: string[]) {
  return new Set(values).size === values.length;
}

export const reorderClassesInputSchema = z.object({
  schoolId: z.string().min(1),
  orderedClassIds: z
    .array(z.string().min(1))
    .min(1)
    .refine(uniqueIds, "Class identifiers must be unique"),
});

export const reorderClassesOutputSchema = z.array(classDtoSchema);

export const reorderSectionsInputSchema = classIdInputSchema.extend({
  orderedSectionIds: z
    .array(z.string().min(1))
    .min(1)
    .refine(uniqueIds, "Section identifiers must be unique"),
});

export const reorderSectionsOutputSchema = z.array(sectionDtoSchema);
