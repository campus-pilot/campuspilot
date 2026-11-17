import { transitionExam } from './exam-lifecycle.service';
import { requireNotReleasedToCadet } from './exam-cadet.service';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { studentTable } from '@campuspilot/db/schema/student';
import {
  examClassTable,
  examPlanTable,
  examResultTable,
  examLifecycleTable,
} from '@campuspilot/db/schema/exam';
import { resolvePaginationInput } from '../../../paginations';
import { pageResult, route } from './exam.pagination';
import {
  getExam,
  getExamSession,
  getExamClass,
  getPlan,
  resolveModeConfig,
} from './exam.service';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { protectedProcedure } from '../../../index';
import { isSchoolFeatureEnabled } from '../../../feature-flags/feature-flags.service';
import { requireSchoolPermission } from '../../../permissions/school';
import { rpcError, toRpcError } from '../../../errors';
import * as dto from './exam.dto';
import { deleteQuestionPapersOfPlan } from '../question-paper/question-paper.service';
import { deleteObjectsBestEffort } from '../question-paper/question-paper.storage';

import {
  prepareExamPlan,
  assertCreatableExamPlan,
} from './exam-plan-generation';
import { includeExamClass, updateExamClasses } from './exam-class.service';

export const schoolExamPlanRouter = {
  getExamPlanPreview: protectedProcedure
    .route(
      route(
        'Preview automatic exam plan',
        'Review every school class, subject and configured assessment mode, and whether each class currently takes part, before generating the plan or changing its classes. No data is written.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .output(dto.examPlanPreviewSchema)
    .handler(async ({ context, input }) => {
      try {
        return (await prepareExamPlan(context.db, input)).preview;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  generateExamPlan: protectedProcedure
    .route(
      route(
        'Generate an exam plan from class configuration',
        'Atomically record the selected classes as taking part and create a ready-to-start plan for each of their configured subjects using its assessment modes and 100 total marks. At least one class is required; a selected class needs subjects with valid modes. Reject existing plans or a changed preview. Timetable creation is a separate step.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.generateExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM_PLAN))
    .output(dto.generateExamPlanOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const prepared = await prepareExamPlan(tx, input, true);
          const plans = assertCreatableExamPlan(
            prepared,
            input.configurationVersion,
            input.classIds,
          );
          // Participation is recorded first: every plan references its class's row.
          await tx.insert(examClassTable).values(
            input.classIds.map((classId) => ({
              schoolId: input.schoolId,
              sessionId: input.sessionId,
              examSlug: input.examSlug,
              classId,
            })),
          );
          // Chunk within the same transaction to stay below PostgreSQL's bind
          // parameter limit even for a large school. Any failure rolls back all rows.
          for (let offset = 0; offset < plans.length; offset += 100) {
            await tx
              .insert(examPlanTable)
              .values(plans.slice(offset, offset + 100));
          }
          await tx
            .insert(examLifecycleTable)
            .values({
              schoolId: input.schoolId,
              sessionId: input.sessionId,
              examSlug: input.examSlug,
              status: 'ready',
            })
            .onConflictDoUpdate({
              target: [
                examLifecycleTable.sessionId,
                examLifecycleTable.examSlug,
              ],
              set: { status: 'ready', startedAt: null, completedAt: null },
            });
          return { createdCount: plans.length };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  updateExamClasses: protectedProcedure
    .route(
      route(
        'Change the classes taking part in an exam',
        'Set the complete list of classes taking part in an exam whose plan exists. Added classes get plans from their class settings; removed classes lose their plans. Refused once the exam has ended or is released to the Cadet Portal, for a stale preview, and for a removed class with saved results, attendance, activities, remarks, question papers, a published timetable including it or a draft timetable scheduling it.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.updateExamClassesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM_PLAN))
    .output(dto.updateExamClassesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { result, questionPaperObjects } = await context.db.transaction(
          (tx) => updateExamClasses(tx, input),
        );
        // Storage is outside the transaction: removed once it has committed.
        await deleteObjectsBestEffort(questionPaperObjects);
        return result;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  listExamPlans: protectedProcedure
    .route(
      route(
        'List exam plans',
        'Read plans for an exam, with independent class and lifecycle status filters, ordered by class, subject and ID.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.listExamPlansInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .output(dto.listExamPlansOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        const where = and(
          eq(examPlanTable.schoolId, input.schoolId),
          eq(examPlanTable.sessionId, input.sessionId),
          eq(examPlanTable.examSlug, input.examSlug),
          input.filters?.classId
            ? eq(examPlanTable.classId, input.filters.classId)
            : undefined,
          input.filters?.status
            ? eq(examPlanTable.status, input.filters.status)
            : undefined,
        );
        const { offset, pageSize } = resolvePaginationInput(input);
        const sortColumns = {
          classId: examPlanTable.classId,
          subjectSlug: examPlanTable.subjectSlug,
          createdAt: examPlanTable.createdAt,
          status: examPlanTable.status,
        };
        const sort = input.orderBy.direction === 'asc' ? asc : desc;
        const [items, [total]] = await Promise.all([
          context.db
            .select()
            .from(examPlanTable)
            .where(where)
            .orderBy(
              sort(sortColumns[input.orderBy.field]),
              asc(examPlanTable.classId),
              asc(examPlanTable.subjectSlug),
              asc(examPlanTable.id),
            )
            .offset(offset)
            .limit(pageSize),
          context.db
            .select({ value: count() })
            .from(examPlanTable)
            .where(where),
        ]);
        return pageResult(items, total!.value, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getExamPlan: protectedProcedure
    .route(
      route(
        'Get an exam plan',
        'Read a plan by its independent school, session, class and plan identifiers.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.planScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return (await getPlan(context.db, input)).plan;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  createExamPlan: protectedProcedure
    .route(
      route(
        'Create an exam plan',
        'Create a draft plan with assessment modes derived from the class subject or explicitly customized percentages. Creating it makes the class take part in the exam if it did not already.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.createExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session } = await getExam(tx, input, 'share');
          await requireNotReleasedToCadet(tx, input);
          const schoolClass = await getExamClass(
            tx,
            input.schoolId,
            input.classId,
          );
          const subject = Object.hasOwn(
            schoolClass.config.subjects,
            input.subjectSlug,
          )
            ? schoolClass.config.subjects[input.subjectSlug]
            : undefined;
          if (!subject)
            throw rpcError.badRequest(
              'The subject is not configured for this class.',
            );
          if (
            input.totalWorkingDays !== null &&
            !session.config.attendanceTracking.enabled
          )
            throw rpcError.badRequest(
              'Attendance tracking is disabled for this session.',
            );
          const modeConfig = resolveModeConfig(
            input.totalMarks,
            subject.examModes,
            input.modeConfig,
          );
          await includeExamClass(tx, input, input.classId);
          const [plan] = await tx
            .insert(examPlanTable)
            .values({ ...input, modeConfig })
            .returning();
          await tx
            .insert(examLifecycleTable)
            .values({
              schoolId: input.schoolId,
              sessionId: input.sessionId,
              examSlug: input.examSlug,
            })
            .onConflictDoNothing();
          return plan!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  updateExamPlan: protectedProcedure
    .route(
      route(
        'Update an exam plan',
        'Edit marks and mode percentages before activation. Editing an approved plan resets it to draft for another review.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.updateExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { plan, session } = await getPlan(tx, input, true);
          await requireNotReleasedToCadet(tx, plan);
          if (!['draft', 'approved'].includes(plan.status))
            throw rpcError.badRequest(
              'Active and completed exam plans are locked.',
            );
          const schoolClass = await getExamClass(
            tx,
            plan.schoolId,
            plan.classId,
          );
          const subject = Object.hasOwn(
            schoolClass.config.subjects,
            plan.subjectSlug,
          )
            ? schoolClass.config.subjects[plan.subjectSlug]
            : undefined;
          if (!subject)
            throw rpcError.badRequest(
              'The plan’s subject is no longer configured for this class.',
            );
          if (
            input.totalWorkingDays !== undefined &&
            input.totalWorkingDays !== null &&
            !session.config.attendanceTracking.enabled
          )
            throw rpcError.badRequest(
              'Attendance tracking is disabled for this session.',
            );
          const totalMarks = input.totalMarks ?? plan.totalMarks;
          const totalWorkingDays =
            input.totalWorkingDays !== undefined
              ? input.totalWorkingDays
              : plan.totalWorkingDays;
          const modeConfig = resolveModeConfig(
            totalMarks,
            subject.examModes,
            input.modeConfig ??
              Object.fromEntries(
                Object.entries(plan.modeConfig).map(([slug, mode]) => [
                  slug,
                  {
                    percentage: mode.percentage,
                    maxMarks: (totalMarks * mode.percentage) / 100,
                  },
                ]),
              ),
          );
          const [updated] = await tx
            .update(examPlanTable)
            .set({
              totalMarks,
              totalWorkingDays,
              modeConfig,
              status: 'draft',
              updatedAt: new Date(),
            })
            .where(eq(examPlanTable.id, plan.id))
            .returning();
          return updated!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  deleteExamPlan: protectedProcedure
    .route(
      route(
        'Delete an exam plan',
        'Delete a draft or approved exam plan; active and completed plans, and plans of an exam released to the Cadet Portal, cannot be deleted.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.planScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { plan, questionPaperObjects } = await context.db.transaction(async (tx) => {
          const { plan } = await getPlan(tx, input, true);
          await requireNotReleasedToCadet(tx, plan);
          if (!['draft', 'approved'].includes(plan.status))
            throw rpcError.badRequest(
              'Active and completed exam plans cannot be deleted.',
            );
          // Question papers are keyed by the plan's class and subject, not
          // linked to the plan row (plans are deleted and regenerated), so
          // they are removed here, in the same transaction.
          const questionPaperObjects = await deleteQuestionPapersOfPlan(tx, plan);
          await tx.delete(examPlanTable).where(eq(examPlanTable.id, plan.id));
          return { plan, questionPaperObjects };
        });
        // Storage is outside the transaction: removed once it has committed.
        await deleteObjectsBestEffort(questionPaperObjects);
        return plan;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  transitionExamPlan: protectedProcedure
    .route(
      route(
        'Transition an exam plan',
        'Enforce draft → approved → active → completed, or completed → active to reopen. Completion requires approved results for all currently registered students enrolled in the class.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.transitionExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          await getExamSession(tx, input, 'update');
          const { plan } = await getPlan(tx, input, true);
          await requireNotReleasedToCadet(tx, plan);
          const transitions = {
            draft: 'approved',
            approved: 'active',
            active: 'completed',
            completed: 'active',
          } as const;
          if (transitions[plan.status] !== input.status)
            throw rpcError.badRequest(
              `Cannot transition an exam plan from ${plan.status} to ${input.status}.`,
            );
          if (input.status === 'active') {
            // Starting never reviews results; the option only matters for completion.
            await transitionExam(
              tx,
              {
                schoolId: plan.schoolId,
                sessionId: plan.sessionId,
                examSlug: plan.examSlug,
                status: 'active',
              },
              { reviewResults: false },
            );
            const [started] = await tx
              .select()
              .from(examPlanTable)
              .where(eq(examPlanTable.id, plan.id));
            return started!;
          }
          // Results can only be reviewed in a school that has student
          // management; without it a plan completes without waiting for them
          // (the same rule as `transitionExam`).
          if (input.status === 'completed' && (await isSchoolFeatureEnabled(tx, plan.schoolId, 'studentManagement'))) {
            const [missing] = await tx
              .select({ studentId: studentTable.id })
              .from(studentTable)
              .innerJoin(
                admissionTable,
                eq(admissionTable.id, studentTable.admissionId),
              )
              .leftJoin(
                examResultTable,
                and(
                  eq(examResultTable.studentId, studentTable.id),
                  eq(examResultTable.examPlanId, plan.id),
                ),
              )
              .where(
                and(
                  eq(studentTable.schoolId, plan.schoolId),
                  eq(studentTable.sessionId, plan.sessionId),
                  eq(studentTable.classId, plan.classId),
                  eq(admissionTable.registered, true),
                  sql`(${examResultTable.id} is null or ${examResultTable.approved} = false)`,
                ),
              )
              .limit(1);
            if (missing)
              throw rpcError.badRequest(
                'Every registered student enrolled in this class must have an approved result before completing the exam plan.',
              );
            const [unapproved] = await tx
              .select({ id: examResultTable.id })
              .from(examResultTable)
              .where(
                and(
                  eq(examResultTable.examPlanId, plan.id),
                  eq(examResultTable.approved, false),
                ),
              )
              .limit(1);
            if (unapproved)
              throw rpcError.badRequest(
                'All saved results must be approved before completing the exam plan.',
              );
          }
          const [updated] = await tx
            .update(examPlanTable)
            .set({ status: input.status, updatedAt: new Date() })
            .where(eq(examPlanTable.id, plan.id))
            .returning();
          if (input.status === 'completed') {
            const [unfinished] = await tx
              .select()
              .from(examPlanTable)
              .where(
                and(
                  eq(examPlanTable.sessionId, plan.sessionId),
                  eq(examPlanTable.examSlug, plan.examSlug),
                  sql`${examPlanTable.status} <> 'completed'`,
                ),
              )
              .limit(1);
            if (!unfinished)
              await tx
                .update(examLifecycleTable)
                .set({ status: 'completed', completedAt: new Date() })
                .where(
                  and(
                    eq(examLifecycleTable.sessionId, plan.sessionId),
                    eq(examLifecycleTable.examSlug, plan.examSlug),
                  ),
                );
          }
          return updated!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
