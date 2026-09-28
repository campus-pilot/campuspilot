import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

export const studentDtoSchema = z.object({
  id: z.string(),
  classId: z.string().nullable(),
  sectionId: z.string().nullable(),
  schoolId: z.string(),
  admissionId: z.string(),
  sessionId: z.string(),
  rollNo: z.number().int().positive().nullable(),
  admission: z.object({
    name: z.string(),
    admissionNo: z.string(),
    photoS3Key: z.string().nullable(),
  }),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type StudentDto = z.infer<typeof studentDtoSchema>;

export function toStudentDto(value: StudentDto): StudentDto {
  return studentDtoSchema.parse(value);
}

export const listStudentsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  filters: z
    .object({
      admissionId: z.string().min(1).optional(),
      classId: z.string().min(1).optional(),
      sectionId: z.string().min(1).optional(),
      unassigned: z.boolean().optional(),
    })
    .refine(
      ({ classId, sectionId, unassigned }) =>
        unassigned !== true ||
        (classId === undefined && sectionId === undefined),
      {
        message: "Unassigned students cannot be combined with class filters.",
      },
    )
    .optional(),
  orderBy: z
    .object({
      field: z.enum(["name", "admissionNo", "rollNo", "createdAt"]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "name", direction: "asc" }),
});

export const listStudentsOutputSchema =
  createPaginatedOutputSchema(studentDtoSchema);

export const studentIdInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  studentId: z.string().min(1),
});

export const removeStudentFromClassInputSchema = studentIdInputSchema.extend({
  confirmationRollNo: z.number().int().positive(),
});

export const createStudentInputSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
  admissionId: z.string().min(1),
  sectionId: z.string().min(1),
  rollNo: z.number().int().positive(),
});

export const updateStudentInputSchema = studentIdInputSchema
  .extend({
    sectionId: z.string().min(1).optional(),
    rollNo: z.number().int().positive().optional(),
  })
  .refine(
    ({
      schoolId: _schoolId,
      sessionId: _sessionId,
      studentId: _studentId,
      ...changes
    }) => Object.values(changes).some((value) => value !== undefined),
    { message: "At least one student field must be provided." },
  );
