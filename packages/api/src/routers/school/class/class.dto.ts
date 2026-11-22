import { attributesSchema } from "@campuspilot/db/schema/jsonb/attributes";
import {
  classConfigInputSchema,
  classConfigSchema,
  examModeSchema,
} from "@campuspilot/db/schema/jsonb/class-config";
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
  // Counts require an explicit academic session; school-wide selectors omit it.
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
  sessionId: z.string().min(1).optional(),
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
  config: classConfigInputSchema
    .optional()
    .describe(
      "Subjects of the new class. Every subject is a classroom subject; leave attachment out or send { kind: 'school' }.",
    ),
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
    config: classConfigInputSchema
      .optional()
      .describe(
        "The whole subject configuration. An existing subject keeps where it is offered (leave attachment out or send it unchanged); a new subject is a classroom subject. Use addClassSubject for an exam-only subject and moveClassSubjectToClassroom to change one.",
      ),
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

/**
 * Slug of a subject or of one of its exam modes, as the classroom subject
 * editor accepts it: lowercase letters, numbers and single hyphens. Older
 * stored slugs are not re-checked.
 */
export const subjectSlugSchema = slugSchema;

/**
 * Where a subject added with `addClassSubject` is offered: the classroom
 * (`school`, every examination of the class) or only one examination
 * (`exam`, named by its session and slug).
 */
export const addClassSubjectAttachmentSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("school") }),
    z.object({
      kind: z.literal("exam"),
      sessionId: z.string().min(1).describe("Session of the examination"),
      examSlug: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe("Exam slug from school.listExams"),
    }),
  ])
  .describe(
    "'school' adds the subject to the classroom (offered in every examination); 'exam' adds it only for that examination.",
  );

/** At most this many exam modes per subject sent to the per-subject procedures (stored configurations are not re-checked). */
export const MAX_SUBJECT_EXAM_MODES = 20;

/** An exam mode sent to the per-subject procedures: names up to 100 characters, as the subject editor allows. */
const subjectExamModeInputSchema = examModeSchema.extend({
  name: z.string().trim().min(1, "Mode name is required").max(100),
});

/**
 * Exam modes of a subject sent to `addClassSubject` / `updateClassSubject`:
 * one to {@link MAX_SUBJECT_EXAM_MODES}, slugs as in the classroom editor,
 * percentages summing to 100. Stricter than the stored schema on purpose:
 * older stored subjects keep parsing.
 */
export const addClassSubjectModesSchema = z
  .record(
    z
      .string()
      .max(100)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Mode slugs use lowercase letters, numbers, and single hyphens only",
      ),
    subjectExamModeInputSchema,
  )
  .refine((modes) => Object.keys(modes).length > 0, "Add at least one exam mode.")
  .refine(
    (modes) => Object.keys(modes).length <= MAX_SUBJECT_EXAM_MODES,
    `Add at most ${MAX_SUBJECT_EXAM_MODES} exam modes.`,
  )
  .refine(
    (modes) =>
      Math.abs(
        Object.values(modes).reduce((sum, mode) => sum + mode.percentage, 0) - 100,
      ) <= 0.001,
    "Exam mode percentages must sum to 100%.",
  )
  .meta({
    description:
      "Map of exam mode slug to { name, percentage }; at least one mode, percentages sum to 100",
    examples: [
      {
        theory: { name: "Theory", percentage: 80 },
        practical: { name: "Practical", percentage: 20 },
      },
    ],
  });

/** A subject name, up to 200 characters as in the subject editor. */
const subjectNameSchema = z.string().trim().min(1, "Subject name is required").max(200);

export const addClassSubjectInputSchema = classIdInputSchema.extend({
  slug: subjectSlugSchema.describe("New subject slug, unique in the class"),
  name: subjectNameSchema,
  examModes: addClassSubjectModesSchema,
  attachment: addClassSubjectAttachmentSchema,
});

export const classSubjectInputSchema = classIdInputSchema.extend({
  subjectSlug: z.string().min(1).describe("Subject slug in the class configuration"),
});

/**
 * `updateClassSubject`: the subject's new name and exam modes, and
 * optionally a new slug (a rename: refused while the subject has plans).
 */
export const updateClassSubjectInputSchema = classSubjectInputSchema.extend({
  slug: subjectSlugSchema
    .optional()
    .describe("New slug, unique in the class; leave out to keep it. Refused while the subject has exam plans."),
  name: subjectNameSchema,
  examModes: addClassSubjectModesSchema,
});

export const classSubjectOutputSchema = z.object({ class: classDtoSchema });

/** The plans a subject change created, one per examination. */
export const createdSubjectPlansSchema = z.array(
  z.object({
    sessionId: z.string(),
    examSlug: z.string(),
    examPlanId: z.string(),
  }),
);

export const classSubjectChangeOutputSchema = z.object({
  class: classDtoSchema,
  createdPlans: createdSubjectPlansSchema,
});
