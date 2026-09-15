import { z } from 'zod';

export const examDefinitionSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Exam name is required')
      .describe("Display name of the exam (e.g. 'Mid-Term', 'Final')"),
    order: z
      .number()
      .int()
      .min(1)
      .describe('Display order (1 = first exam of the session)'),
  })
  .describe('An exam defined for the academic session');

export const examConfigSchema = z
  .record(
    z.string().min(1).describe("Exam slug (e.g. 'midterm', 'final')"),
    examDefinitionSchema,
  )
  .describe('Map of exam slug to exam definition for the session');

export const coScholasticAreaSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Area name is required')
      .describe("Display name (e.g. 'Art & Craft', 'Physical Education')"),
  })
  .describe('A co-scholastic assessment area');

export const coScholasticAreasSchema = z
  .record(
    z.string().min(1).describe("Area slug (e.g. 'art', 'sports')"),
    coScholasticAreaSchema,
  )
  .describe('Map of co-scholastic area slug to area definition');

// In dropdowns and selectors this must be shown top to bottom in descending order of minScore,
export const gradeSchema = z
  .object({
    label: z
      .string()
      .min(1, 'Grade label is required')
      .describe("Grade label (e.g. 'A+', 'A', 'B')"),
    minScore: z
      .number()
      .int()
      .min(0)
      .describe('Minimum percentage score to achieve this grade'),
  })
  .describe('A grade definition with label and minimum score threshold');

export const gradingScaleSchema = z
  .record(
    z.string().min(1).describe("Grade key (e.g. 'a_plus', 'a', 'b')"),
    gradeSchema,
  )
  .describe(
    'Map of grade key to grade definition, ordered by minScore descending',
  );

export const attendanceTrackingSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether attendance tracking is enabled for this session'),
  })
  .describe('Attendance tracking configuration');

export const sessionConfigSchema = z
  .object({
    examConfig: examConfigSchema
      .optional()
      .default({})
      .describe('Exams defined for this session'),
    coScholasticAreas: coScholasticAreasSchema
      .optional()
      .default({})
      .describe('Co-scholastic areas assessed in this session'),
    gradingScale: gradingScaleSchema
      .optional()
      .default({})
      .describe('Grading scale for converting marks to grades'),
    attendanceTracking: attendanceTrackingSchema
      .optional()
      .default({ enabled: false })
      .describe('Attendance tracking settings'),
  })
  .describe(
    'Academic session configuration: exams, grading, co-scholastic areas, and attendance',
  );

export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export type ExamDefinition = z.infer<typeof examDefinitionSchema>;
export type CoScholasticArea = z.infer<typeof coScholasticAreaSchema>;
export type GradeDefinition = z.infer<typeof gradeSchema>;
