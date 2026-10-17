import { z } from 'zod';
import {
  coScholasticGradesSchema,
  examPlanStatusSchema,
  modeConfigSchema,
  resultMarksSchema,
  timetableConfigSchema,
} from '@campuspilot/db/schema/jsonb/exam-config';
import { examDefinitionSchema } from '@campuspilot/db/schema/jsonb/session-config';
import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from '../../../paginations';

export const sessionScopeSchema = z.object({
  schoolId: z.string().min(1),
  sessionId: z.string().min(1),
});
export const examScopeSchema = sessionScopeSchema.extend({
  examSlug: z.string().trim().min(1).max(100),
});
export const planScopeSchema = sessionScopeSchema.extend({
  classId: z.string().min(1),
  examPlanId: z.string().min(1),
});
export const examDtoSchema = examDefinitionSchema.extend({ slug: z.string() });
export const createExamInputSchema = examScopeSchema.extend({
  name: z.string().trim().min(1).max(200),
  order: z.number().int().positive(),
});
export const updateExamInputSchema = examScopeSchema
  .extend({
    name: z.string().trim().min(1).max(200).optional(),
    order: z.number().int().positive().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.order !== undefined,
    'Provide an exam field to update',
  );
export const listExamsInputSchema = createListInputSchema({
  ...sessionScopeSchema.shape,
  orderBy: z
    .object({
      field: z.enum(['order', 'name', 'slug']),
      direction: z.enum(['asc', 'desc']).default('asc'),
    })
    .default({ field: 'order', direction: 'asc' }),
});
export const examOverviewSchema = z.object({
  planCount: z.number().int().nonnegative(),
  status: z.enum(['ready', 'active', 'completed']).nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
});
export const listExamsOutputSchema = createPaginatedOutputSchema(
  examDtoSchema.extend(examOverviewSchema.shape),
);
export type ExamOverviewDto = z.infer<typeof examOverviewSchema>;
export const examPlanDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  sessionId: z.string(),
  examSlug: z.string(),
  classId: z.string(),
  subjectSlug: z.string(),
  totalMarks: z.number().int().positive(),
  modeConfig: modeConfigSchema,
  totalWorkingDays: z.number().int().nonnegative().nullable(),
  status: examPlanStatusSchema,
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});
export const planValuesSchema = z.object({
  totalMarks: z.number().int().positive().max(2147483647),
  modeConfig: modeConfigSchema.optional(),
  totalWorkingDays: z
    .number()
    .int()
    .nonnegative()
    .max(2147483647)
    .nullable()
    .default(null),
});
export const createExamPlanInputSchema = examScopeSchema.extend({
  classId: z.string().min(1),
  subjectSlug: z.string().min(1),
  ...planValuesSchema.shape,
  totalMarks: planValuesSchema.shape.totalMarks.default(100),
});
/** Patch inputs preserve omitted fields; creation defaults must not clear existing values. */
export const updateExamPlanInputSchema = planScopeSchema
  .extend({
    totalMarks: planValuesSchema.shape.totalMarks.optional(),
    modeConfig: modeConfigSchema.optional(),
    totalWorkingDays: planValuesSchema.shape.totalWorkingDays
      .unwrap()
      .optional(),
  })
  .refine(
    (value) =>
      value.totalMarks !== undefined ||
      value.modeConfig !== undefined ||
      value.totalWorkingDays !== undefined,
    'Provide a plan field to update',
  );
export const transitionExamPlanInputSchema = planScopeSchema.extend({
  status: examPlanStatusSchema,
});
export const listExamPlansInputSchema = createListInputSchema({
  ...examScopeSchema.shape,
  filters: z
    .object({
      classId: z.string().min(1).optional(),
      status: examPlanStatusSchema.optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(['classId', 'subjectSlug', 'createdAt', 'status']),
      direction: z.enum(['asc', 'desc']).default('asc'),
    })
    .default({ field: 'classId', direction: 'asc' }),
});
export const listExamPlansOutputSchema =
  createPaginatedOutputSchema(examPlanDtoSchema);
export const examResultDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  sessionId: z.string(),
  examPlanId: z.string(),
  studentId: z.string(),
  marks: resultMarksSchema,
  coScholastics: coScholasticGradesSchema.nullable(),
  daysAttended: z.number().int().nonnegative().nullable(),
  approved: z.boolean(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});
export const resultValuesSchema = z.object({
  studentId: z.string().min(1),
  marks: resultMarksSchema,
  coScholastics: coScholasticGradesSchema.nullable().default(null),
  daysAttended: z
    .number()
    .int()
    .nonnegative()
    .max(2147483647)
    .nullable()
    .default(null),
  approved: z.boolean().default(false),
});
export const upsertExamResultInputSchema = planScopeSchema.extend(
  resultValuesSchema.shape,
);
export const upsertExamResultsInputSchema = planScopeSchema.extend({
  results: z
    .array(resultValuesSchema)
    .min(1)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.studentId)).size === rows.length,
      'Students must be unique in a batch',
    ),
});
export const resultScopeSchema = planScopeSchema.extend({
  studentId: z.string().min(1),
});
export const approveExamResultInputSchema = resultScopeSchema.extend({
  approved: z.boolean(),
});
export const listExamResultsInputSchema = createListInputSchema({
  ...planScopeSchema.shape,
  filters: z
    .object({
      studentId: z.string().min(1).optional(),
      approved: z.boolean().optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(['studentId', 'createdAt', 'approved']),
      direction: z.enum(['asc', 'desc']).default('asc'),
    })
    .default({ field: 'studentId', direction: 'asc' }),
});
export const listExamRosterInputSchema = createListInputSchema({
  ...planScopeSchema.shape,
  orderBy: z
    .object({
      field: z.enum(['name', 'admissionNo', 'rollNo']),
      direction: z.enum(['asc', 'desc']).default('asc'),
    })
    .default({ field: 'name', direction: 'asc' }),
});
export const listExamResultsOutputSchema =
  createPaginatedOutputSchema(examResultDtoSchema);
export const rosterEntrySchema = z.object({
  studentId: z.string(),
  name: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().nullable(),
  result: examResultDtoSchema.nullable(),
});
export const listExamRosterOutputSchema =
  createPaginatedOutputSchema(rosterEntrySchema);
export const timetableDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  sessionId: z.string(),
  examSlug: z.string(),
  config: timetableConfigSchema,
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});
export const saveExamTimetableInputSchema = examScopeSchema.extend({
  config: timetableConfigSchema,
});
export const examContextDtoSchema = z.object({
  exam: examDtoSchema,
  classes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      subjects: z.record(
        z.string(),
        z.object({
          name: z.string(),
          examModes: z.record(
            z.string(),
            z.object({ name: z.string(), percentage: z.number() }),
          ),
        }),
      ),
    }),
  ),
  coScholasticAreas: z.record(z.string(), z.object({ name: z.string() })),
  attendanceTracking: z.object({ enabled: z.boolean() }),
});
export type ExamPlanDto = z.infer<typeof examPlanDtoSchema>;
export type ExamResultDto = z.infer<typeof examResultDtoSchema>;
export type ExamContextDto = z.infer<typeof examContextDtoSchema>;

export const examPlanPreviewSchema = z.object({
  totalMarks: z.literal(100),
  configurationVersion: z.string().regex(/^[a-f0-9]{64}$/),
  planCount: z.number().int().nonnegative(),
  existingPlanCount: z.number().int().nonnegative(),
  classes: z.array(
    z.object({
      classId: z.string(),
      label: z.string(),
      studentCount: z.number().int().nonnegative(),
      subjects: z.array(
        z.object({
          subjectSlug: z.string(),
          name: z.string(),
          issue: z.string().nullable(),
          modes: z.array(
            z.object({
              slug: z.string(),
              name: z.string(),
              percentage: z.number(),
              maxMarks: z.number(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export const generateExamPlanInputSchema = examScopeSchema.extend({
  configurationVersion: examPlanPreviewSchema.shape.configurationVersion,
});
export const generateExamPlanOutputSchema = z.object({
  createdCount: z.number().int().positive(),
});
export type ExamPlanPreviewDto = z.infer<typeof examPlanPreviewSchema>;

export const examClassScopeSchema = examScopeSchema.extend({
  classId: z.string().min(1),
});
export const examStudentScopeSchema = examClassScopeSchema.extend({
  studentId: z.string().min(1),
});
export const studentAssessmentSchema = z.object({
  daysAttended: z.number().int().nonnegative().nullable(),
  coScholastics: coScholasticGradesSchema.nullable(),
  approved: z.boolean(),
  updatedAt: z.date(),
});
export const examClassSummarySchema = z.object({
  classId: z.string(),
  label: z.string(),
  studentCount: z.number().int(),
  subjectCount: z.number().int(),
  modeCount: z.number().int(),
  sections: z.array(z.object({ id: z.string(), label: z.string() })),
  statuses: z.array(examPlanStatusSchema),
});
export const listExamClassesInputSchema = createListInputSchema({
  ...examScopeSchema.shape,
  filters: z.object({ classId: z.string().min(1).optional() }).optional(),
});
export const listExamClassesOutputSchema = createPaginatedOutputSchema(
  examClassSummarySchema,
);
export const listExamStudentsInputSchema = createListInputSchema({
  ...examClassScopeSchema.shape,
  filters: z.object({ sectionId: z.string().min(1).optional() }).optional(),
  searchQuery: z.string().trim().max(100).default(''),
});
export const examStudentSummarySchema = z.object({
  studentId: z.string(),
  name: z.string(),
  admissionNo: z.string(),
  rollNo: z.number().nullable(),
  sectionId: z.string().nullable(),
  sectionLabel: z.string().nullable(),
  savedSubjects: z.number().int(),
  approvedSubjects: z.number().int(),
  subjectCount: z.number().int(),
  assessmentApproved: z.boolean(),
});
export const listExamStudentsOutputSchema = createPaginatedOutputSchema(
  examStudentSummarySchema,
);
export const studentExamWorkspaceSchema = z.object({
  student: examStudentSummarySchema,
  className: z.string(),
  context: examContextDtoSchema,
  subjects: z.array(
    z.object({
      plan: examPlanDtoSchema,
      result: examResultDtoSchema.nullable(),
    }),
  ),
  assessment: studentAssessmentSchema.nullable(),
  totalWorkingDays: z.number().int().nonnegative().nullable(),
});
export const saveStudentExamInputSchema = examStudentScopeSchema.extend({
  subjects: z
    .array(
      z.object({ examPlanId: z.string().min(1), marks: resultMarksSchema }),
    )
    .min(1)
    .max(500)
    .refine(
      (rows) => new Set(rows.map((row) => row.examPlanId)).size === rows.length,
      'Subject plans must be unique',
    ),
  daysAttended: resultValuesSchema.shape.daysAttended,
  coScholastics: resultValuesSchema.shape.coScholastics,
  approved: z.boolean().default(false),
});
export const examAssessmentSettingsSchema = examScopeSchema.extend({
  totalWorkingDays: planValuesSchema.shape.totalWorkingDays,
});
export const examLifecycleInputSchema = examScopeSchema.extend({
  status: z.enum(['active', 'completed']),
});
export type StudentExamWorkspaceDto = z.infer<
  typeof studentExamWorkspaceSchema
>;
