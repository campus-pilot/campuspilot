import { attributesSchema } from "@campuspilot/db/schema/jsonb/attributes";
import { classConfigSchema } from "@campuspilot/db/schema/jsonb/class-config";
import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

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
  classId: z.string(),
  schoolId: z.string(),
  attributes: attributesSchema,
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type ClassDto = z.infer<typeof classDtoSchema>;
export type SectionDto = z.infer<typeof sectionDtoSchema>;

export function toClassDto(value: ClassDto): ClassDto {
  return classDtoSchema.parse(value);
}

export function toSectionDto(value: SectionDto): SectionDto {
  return sectionDtoSchema.parse(value);
}

export const listClassesInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  searchQuery: z.string().trim().min(1).max(100).optional(),
  orderBy: z
    .object({
      field: z.enum(["slug", "label", "createdAt", "updatedAt"]),
      direction: z.enum(["asc", "desc"]),
    })
    .default({ field: "label", direction: "asc" }),
});

export const listClassesOutputSchema =
  createPaginatedOutputSchema(classDtoSchema);

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

export const listSectionsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  classId: z.string().min(1),
  searchQuery: z.string().trim().min(1).max(100).optional(),
  orderBy: z
    .object({
      field: z.enum(["slug", "label", "createdAt", "updatedAt"]),
      direction: z.enum(["asc", "desc"]),
    })
    .default({ field: "label", direction: "asc" }),
});

export const listSectionsOutputSchema =
  createPaginatedOutputSchema(sectionDtoSchema);

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
