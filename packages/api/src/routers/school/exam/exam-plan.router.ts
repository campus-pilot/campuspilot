import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { examPlanTable, examResultTable } from "@campuspilot/db/schema/exam";
import { resolvePaginationInput } from "../../../paginations";
import { pageResult, route } from "./exam.pagination";
import {
  getExam,
  getExamClass,
  getPlan,
  resolveModeConfig,
} from "./exam.service";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import { rpcError, toRpcError } from "../../../errors";
import * as dto from "./exam.dto";

import { prepareExamPlan, assertCreatableExamPlan } from './exam-plan-generation';

export const schoolExamPlanRouter = {
  getExamPlanPreview: protectedProcedure
    .route(route('Preview automatic exam plan', 'Review every school class, subject and configured assessment mode before generating the initial draft plan. No data is written.'))
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_PLANS))
    .output(dto.examPlanPreviewSchema)
    .handler(async ({ context, input }) => {
      try { return (await prepareExamPlan(context.db, input)).preview; }
      catch (error) { throw toRpcError(error); }
    }),
  generateExamPlan: protectedProcedure
    .route(route('Generate an exam plan from class configuration', 'Atomically create a draft plan for every configured class subject using its assessment modes and 100 total marks. Reject existing plans, invalid configuration or a changed preview. Timetable creation is a separate step.'))
    .input(dto.generateExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM_PLAN))
    .output(dto.generateExamPlanOutputSchema)
    .handler(async ({ context, input }) => {
      try { return await context.db.transaction(async (tx) => {
        const prepared = await prepareExamPlan(tx, input, true);
        assertCreatableExamPlan(prepared, input.configurationVersion);
        // Chunk within the same transaction to stay below PostgreSQL's bind
        // parameter limit even for a large school. Any failure rolls back all rows.
        for (let offset = 0; offset < prepared.plans.length; offset += 100) {
          await tx.insert(examPlanTable).values(prepared.plans.slice(offset, offset + 100));
        }
        return { createdCount: prepared.plans.length };
      }); } catch (error) { throw toRpcError(error); }
    }),
  listExamPlans: protectedProcedure
    .route(
      route(
        "List exam plans",
        "Read plans for an exam, with independent class and lifecycle status filters, ordered by class, subject and ID.",
      ),
    )
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
        const sort = input.orderBy.direction === "asc" ? asc : desc;
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
        "Get an exam plan",
        "Read a plan by its independent school, session, class and plan identifiers.",
      ),
    )
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
        "Create an exam plan",
        "Create a draft plan with assessment modes derived from the class subject or explicitly customized percentages.",
      ),
    )
    .input(dto.createExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session } = await getExam(tx, input, "share");
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
              "The subject is not configured for this class.",
            );
          if (
            input.totalWorkingDays !== null &&
            !session.config.attendanceTracking.enabled
          )
            throw rpcError.badRequest(
              "Attendance tracking is disabled for this session.",
            );
          const modeConfig = resolveModeConfig(
            input.totalMarks,
            subject.examModes,
            input.modeConfig,
          );
          const [plan] = await tx
            .insert(examPlanTable)
            .values({ ...input, modeConfig })
            .returning();
          return plan!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  updateExamPlan: protectedProcedure
    .route(
      route(
        "Update an exam plan",
        "Edit marks and mode percentages before activation. Editing an approved plan resets it to draft for another review.",
      ),
    )
    .input(dto.updateExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { plan, session } = await getPlan(tx, input, true);
          if (!["draft", "approved"].includes(plan.status))
            throw rpcError.badRequest(
              "Active and completed exam plans are locked.",
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
              "The plan’s subject is no longer configured for this class.",
            );
          if (
            input.totalWorkingDays !== undefined &&
            input.totalWorkingDays !== null &&
            !session.config.attendanceTracking.enabled
          )
            throw rpcError.badRequest(
              "Attendance tracking is disabled for this session.",
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
              status: "draft",
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
        "Delete an exam plan",
        "Delete a draft or approved exam plan; active and completed plans cannot be deleted.",
      ),
    )
    .input(dto.planScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { plan } = await getPlan(tx, input, true);
          if (!["draft", "approved"].includes(plan.status))
            throw rpcError.badRequest(
              "Active and completed exam plans cannot be deleted.",
            );
          await tx.delete(examPlanTable).where(eq(examPlanTable.id, plan.id));
          return plan;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  transitionExamPlan: protectedProcedure
    .route(
      route(
        "Transition an exam plan",
        "Enforce draft → approved → active → completed, or completed → active to reopen. Completion requires approved results for all currently registered students enrolled in the class.",
      ),
    )
    .input(dto.transitionExamPlanInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN))
    .output(dto.examPlanDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { plan } = await getPlan(tx, input, true);
          const transitions = {
            draft: "approved",
            approved: "active",
            active: "completed",
            completed: "active",
          } as const;
          if (transitions[plan.status] !== input.status)
            throw rpcError.badRequest(
              `Cannot transition an exam plan from ${plan.status} to ${input.status}.`,
            );
          if (input.status === "completed") {
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
                "Every registered student enrolled in this class must have an approved result before completing the exam plan.",
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
                "All saved results must be approved before completing the exam plan.",
              );
          }
          const [updated] = await tx
            .update(examPlanTable)
            .set({ status: input.status, updatedAt: new Date() })
            .where(eq(examPlanTable.id, plan.id))
            .returning();
          return updated!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
