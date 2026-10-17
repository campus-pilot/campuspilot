import { assessmentWhere, examWhere, settingsWhere } from './exam.scope';
import { transitionExam } from './exam-lifecycle.service';
import { z } from 'zod';
import { and, asc, count, eq, exists, inArray, sql } from 'drizzle-orm';
import { classTable, sectionTable } from '@campuspilot/db/schema/class';
import { studentTable } from '@campuspilot/db/schema/student';
import { admissionTable } from '@campuspilot/db/schema/admission';
import {
  examPlanTable,
  examAssessmentSettingsTable,
  examStudentAssessmentTable,
} from '@campuspilot/db/schema/exam';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import { requireExamResultPermissions } from '../../../permissions/exam';
import { rpcError, toRpcError } from '../../../errors';
import { resolvePaginationInput } from '../../../paginations';
import { pageResult, route } from './exam.pagination';
import { getExam, getExamClass } from './exam.service';
import {
  saveStudentExam,
  studentQuery,
  studentWhere,
  studentWorkspace,
} from './exam-student.service';
import * as dto from './exam.dto';

export const schoolExamStudentRouter = {
  listExamClasses: protectedProcedure
    .route(
      route(
        'List examination classes',
        'Paginated classes with saved exam plans, enrolled student counts, sections, subject/mode counts and lifecycle states.',
      ),
    )
    .input(dto.listExamClassesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .output(dto.listExamClassesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        const where = and(
          eq(classTable.schoolId, input.schoolId),
          input.filters?.classId
            ? eq(classTable.id, input.filters.classId)
            : undefined,
          exists(
            context.db
              .select({ id: examPlanTable.id })
              .from(examPlanTable)
              .where(
                and(examWhere(input), eq(examPlanTable.classId, classTable.id)),
              ),
          ),
        );
        const { offset, pageSize } = resolvePaginationInput(input);
        const [classes, [total]] = await Promise.all([
          context.db
            .select()
            .from(classTable)
            .where(where)
            .orderBy(asc(classTable.displayOrder), asc(classTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db.select({ value: count() }).from(classTable).where(where),
        ]);
        // Bound supporting reads to this page rather than loading the whole school.
        if (!classes.length) return pageResult([], total!.value, input);
        const classIds = classes.map((entry) => entry.id);
        const [plans, sections, students] = await Promise.all([
          context.db
            .select({
              classId: examPlanTable.classId,
              modeConfig: examPlanTable.modeConfig,
              status: examPlanTable.status,
            })
            .from(examPlanTable)
            .where(
              and(examWhere(input), inArray(examPlanTable.classId, classIds)),
            ),
          context.db
            .select()
            .from(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                inArray(sectionTable.classId, classIds),
              ),
            )
            .orderBy(asc(sectionTable.displayOrder), asc(sectionTable.id)),
          context.db
            .select({ classId: studentTable.classId, value: count() })
            .from(studentTable)
            .innerJoin(
              admissionTable,
              eq(admissionTable.id, studentTable.admissionId),
            )
            .where(
              and(
                eq(studentTable.schoolId, input.schoolId),
                eq(studentTable.sessionId, input.sessionId),
                inArray(studentTable.classId, classIds),
                eq(admissionTable.registered, true),
                eq(admissionTable.schoolId, input.schoolId),
              ),
            )
            .groupBy(studentTable.classId),
        ]);
        return pageResult(
          classes.map((schoolClass) => {
            const subjects = plans.filter(
              (plan) => plan.classId === schoolClass.id,
            );
            return {
              classId: schoolClass.id,
              label: schoolClass.label,
              studentCount:
                students.find((row) => row.classId === schoolClass.id)?.value ??
                0,
              subjectCount: subjects.length,
              modeCount: subjects.reduce(
                (sum, plan) => sum + Object.keys(plan.modeConfig).length,
                0,
              ),
              sections: sections
                .filter((section) => section.classId === schoolClass.id)
                .map(({ id, label }) => ({ id, label })),
              statuses: [...new Set(subjects.map((plan) => plan.status))],
            };
          }),
          total!.value,
          input,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  listExamStudents: protectedProcedure
    .route(
      route(
        'List students in an examination class',
        'Read a paginated registered class roster with explicit section and name filters and saved/approved subject progress, ordered by name then student ID.',
      ),
    )
    .input(dto.listExamStudentsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .output(dto.listExamStudentsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        await getExamClass(context.db, input.schoolId, input.classId);
        const [plan] = await context.db
          .select({ id: examPlanTable.id })
          .from(examPlanTable)
          .where(
            and(examWhere(input), eq(examPlanTable.classId, input.classId)),
          )
          .limit(1);
        if (!plan) throw rpcError.notFound('Exam plan for this class');
        if (input.filters?.sectionId) {
          const [section] = await context.db
            .select()
            .from(sectionTable)
            .where(
              and(
                eq(sectionTable.id, input.filters.sectionId),
                eq(sectionTable.classId, input.classId),
                eq(sectionTable.schoolId, input.schoolId),
              ),
            );
          if (!section) throw rpcError.notFound('Section in this class');
        }
        const where = studentWhere(input, input.filters, input.searchQuery);
        const { offset, pageSize } = resolvePaginationInput(input);
        const [items, [total]] = await Promise.all([
          studentQuery(context.db, input)
            .where(where)
            .orderBy(asc(admissionTable.name), asc(studentTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ value: count() })
            .from(studentTable)
            .innerJoin(
              admissionTable,
              eq(admissionTable.id, studentTable.admissionId),
            )
            .where(where),
        ]);
        return pageResult(items, total!.value, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getStudentExam: protectedProcedure
    .route(
      route(
        'Get a student examination workspace',
        'Read all subject scores and snapshots, shared attendance/activities, section, student identity and current assessment configuration for one enrolled student.',
      ),
    )
    .input(dto.examStudentScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .output(dto.studentExamWorkspaceSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(
          (tx) => studentWorkspace(tx, input),
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  saveStudentExam: protectedProcedure
    .route(
      route(
        'Save a complete student examination',
        'Atomically save every subject plus one student-wide attendance/activity assessment. Explicit approved=true requires assigned class teacher or school exam administrator; changing any approved component requires elevated revision access.',
      ),
    )
    .input(dto.saveStudentExamInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.WRITE_EXAM_RESULTS))
    .use(requireExamResultPermissions)
    .output(dto.studentExamWorkspaceSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) =>
          saveStudentExam(tx, input, context.canReviseExamResults),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getExamAssessmentSettings: protectedProcedure
    .route(
      route(
        'Get examination attendance settings',
        'Read the explicitly configured working-day limit for student-wide attendance. Legacy subject working days are independent and are never inferred.',
      ),
    )
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .output(z.object({ totalWorkingDays: z.number().int().nullable() }))
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        const [settings] = await context.db
          .select()
          .from(examAssessmentSettingsTable)
          .where(settingsWhere(input));
        return { totalWorkingDays: settings?.totalWorkingDays ?? null };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  updateExamAssessmentSettings: protectedProcedure
    .route(
      route(
        'Set examination attendance working days',
        'School exam administrators configure one working-day limit while result entry is open. Reject limits below existing attendance and preserve subject configuration.',
      ),
    )
    .input(dto.examAssessmentSettingsSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM_PLAN))
    .output(z.object({ totalWorkingDays: z.number().int().nullable() }))
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session } = await getExam(tx, input, 'update');
          if (!session.config.attendanceTracking.enabled)
            throw rpcError.badRequest(
              'Attendance tracking is disabled for this session.',
            );
          const plans = await tx
            .select()
            .from(examPlanTable)
            .where(examWhere(input));
          if (
            !plans.length ||
            plans.some((plan) => plan.status === 'completed')
          )
            throw rpcError.badRequest(
              'Working days can be changed only for an existing, open examination.',
            );
          const [invalid] = await tx
            .select()
            .from(examStudentAssessmentTable)
            .where(
              and(
                assessmentWhere(input),
                input.totalWorkingDays === null
                  ? sql`${examStudentAssessmentTable.daysAttended} is not null`
                  : sql`${examStudentAssessmentTable.daysAttended} > ${input.totalWorkingDays}`,
              ),
            )
            .limit(1);
          if (invalid)
            throw rpcError.badRequest(
              'Working days cannot be cleared or reduced below recorded student attendance.',
            );
          await tx
            .insert(examAssessmentSettingsTable)
            .values({
              schoolId: input.schoolId,
              sessionId: input.sessionId,
              examSlug: input.examSlug,
              totalWorkingDays: input.totalWorkingDays,
            })
            .onConflictDoUpdate({
              target: [
                examAssessmentSettingsTable.sessionId,
                examAssessmentSettingsTable.examSlug,
              ],
              set: { totalWorkingDays: input.totalWorkingDays },
            });
          return { totalWorkingDays: input.totalWorkingDays };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  transitionExam: protectedProcedure
    .route(
      route(
        'Complete or reopen an examination',
        'Change all subject plans together. Completion requires approved subject results for every registered enrollment and reviewed enabled student-wide assessments. Reopen preserves all saved values and approvals; also opens legacy draft/approved plans without per-subject approval.',
      ),
    )
    .input(dto.examLifecycleInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN))
    .output(z.object({ updatedCount: z.number().int().positive() }))
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) => transitionExam(tx, input));
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
