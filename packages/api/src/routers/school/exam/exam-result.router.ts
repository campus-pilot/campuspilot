import { z } from "zod";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { examResultTable } from "@campuspilot/db/schema/exam";
import { CLASS_ACTIONS } from "@campuspilot/opa/policies/class";
import { requireClassPermission } from "../../../permissions/class";
import { requireExamResultPermissions } from "../../../permissions/exam";
import { resolvePaginationInput } from "../../../paginations";
import { pageResult, route } from "./exam.pagination";
import {
  getPlan,
  requireActivePlan,
  requireRevisionPermission,
  saveResults,
} from "./exam.service";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import { rpcError, toRpcError } from "../../../errors";
import * as dto from "./exam.dto";

export const schoolExamResultRouter = {
  listExamResults: protectedProcedure
    .route(
      route(
        "List exam results",
        "Read saved results for one exam plan in student ID and result ID order.",
      ),
    )
    .input(dto.listExamResultsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .output(dto.listExamResultsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { plan } = await getPlan(context.db, input);
        const where = and(
          eq(examResultTable.examPlanId, plan.id),
          input.filters?.studentId
            ? eq(examResultTable.studentId, input.filters.studentId)
            : undefined,
          input.filters?.approved !== undefined
            ? eq(examResultTable.approved, input.filters.approved)
            : undefined,
        );
        const sortColumns = {
          studentId: examResultTable.studentId,
          createdAt: examResultTable.createdAt,
          approved: examResultTable.approved,
        };
        const sort = input.orderBy.direction === "asc" ? asc : desc;
        const { offset, pageSize } = resolvePaginationInput(input);
        const [items, [total]] = await Promise.all([
          context.db
            .select()
            .from(examResultTable)
            .where(where)
            .orderBy(
              sort(sortColumns[input.orderBy.field]),
              asc(examResultTable.studentId),
              asc(examResultTable.id),
            )
            .offset(offset)
            .limit(pageSize),
          context.db
            .select({ value: count() })
            .from(examResultTable)
            .where(where),
        ]);
        return pageResult(items, total!.value, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  listExamRoster: protectedProcedure
    .route(
      route(
        "List exam result entry roster",
        "Read currently registered students in the plan’s class and session alongside their optional result, ordered by student name and ID.",
      ),
    )
    .input(dto.listExamRosterInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .output(dto.listExamRosterOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { plan } = await getPlan(context.db, input);
        const where = and(
          eq(studentTable.schoolId, input.schoolId),
          eq(studentTable.sessionId, input.sessionId),
          eq(studentTable.classId, input.classId),
          eq(admissionTable.schoolId, input.schoolId),
          eq(admissionTable.registered, true),
        );
        const { offset, pageSize } = resolvePaginationInput(input);
        const sortColumns = {
          name: admissionTable.name,
          admissionNo: admissionTable.admissionNo,
          rollNo: studentTable.rollNo,
        };
        const sort = input.orderBy.direction === "asc" ? asc : desc;
        const [items, [total]] = await Promise.all([
          context.db
            .select({
              studentId: studentTable.id,
              name: admissionTable.name,
              admissionNo: admissionTable.admissionNo,
              rollNo: studentTable.rollNo,
              result: examResultTable,
            })
            .from(studentTable)
            .innerJoin(
              admissionTable,
              eq(admissionTable.id, studentTable.admissionId),
            )
            .leftJoin(
              examResultTable,
              and(
                eq(examResultTable.examPlanId, plan.id),
                eq(examResultTable.studentId, studentTable.id),
              ),
            )
            .where(where)
            .orderBy(
              sort(sortColumns[input.orderBy.field]),
              asc(studentTable.id),
            )
            .offset(offset)
            .limit(pageSize),
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
  getExamResult: protectedProcedure
    .route(
      route(
        "Get a student exam result",
        "Read the saved result for an independently scoped plan and student.",
      ),
    )
    .input(dto.resultScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .output(dto.examResultDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        await getPlan(context.db, input);
        const [result] = await context.db
          .select()
          .from(examResultTable)
          .where(
            and(
              eq(examResultTable.examPlanId, input.examPlanId),
              eq(examResultTable.studentId, input.studentId),
            ),
          )
          .limit(1);
        if (!result) throw rpcError.notFound("Exam result");
        return result;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  upsertExamResult: protectedProcedure
    .route(
      route(
        "Save a student exam result",
        "Create or update a result while the plan is active. Teachers can enter any class; approved=true additionally requires the assigned class teacher or a school exam administrator.",
      ),
    )
    .input(dto.upsertExamResultInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.WRITE_EXAM_RESULTS))
    .use(requireExamResultPermissions)
    .output(dto.examResultDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return (
          await context.db.transaction((tx) =>
            saveResults(tx, input, [input], context.canReviseExamResults),
          )
        )[0]!;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  upsertExamResults: protectedProcedure
    .route(
      route(
        "Save a batch of exam results",
        "Atomically save up to 100 students with explicit approval flags and an additional assigned-class approval check. Any failure rolls back the complete batch.",
      ),
    )
    .input(dto.upsertExamResultsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.WRITE_EXAM_RESULTS))
    .use(requireExamResultPermissions)
    .output(z.array(dto.examResultDtoSchema))
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) =>
          saveResults(tx, input, input.results, context.canReviseExamResults),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  approveExamResult: protectedProcedure
    .route(
      route(
        "Review an exam result",
        "Approve a saved result as its assigned class teacher or a school exam administrator. Only administrators can revoke or change an existing approval.",
      ),
    )
    .input(dto.approveExamResultInputSchema)
    .use(requireClassPermission(CLASS_ACTIONS.APPROVE_EXAM_RESULTS))
    .use(requireExamResultPermissions)
    .output(dto.examResultDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { plan } = await getPlan(tx, input, true);
          requireActivePlan(plan);
          const [result] = await tx
            .select()
            .from(examResultTable)
            .where(
              and(
                eq(examResultTable.examPlanId, plan.id),
                eq(examResultTable.studentId, input.studentId),
              ),
            )
            .limit(1);
          if (!result) throw rpcError.notFound("Exam result");
          if (result.approved === input.approved) return result;
          requireRevisionPermission(
            result.approved,
            context.canReviseExamResults,
          );
          const [updated] = await tx
            .update(examResultTable)
            .set({ approved: input.approved, updatedAt: new Date() })
            .where(eq(examResultTable.id, result.id))
            .returning();
          return updated!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  deleteExamResult: protectedProcedure
    .route(
      route(
        "Delete a student exam result",
        "Delete an active-plan result. Teachers may delete unapproved results across the school; approved results require a school exam administrator.",
      ),
    )
    .input(dto.resultScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM_RESULTS))
    .use(requireExamResultPermissions)
    .output(dto.examResultDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { plan } = await getPlan(tx, input, true);
          requireActivePlan(plan);
          const [result] = await tx
            .select()
            .from(examResultTable)
            .where(
              and(
                eq(examResultTable.examPlanId, plan.id),
                eq(examResultTable.studentId, input.studentId),
              ),
            )
            .limit(1);
          if (!result) throw rpcError.notFound("Exam result");
          requireRevisionPermission(
            result.approved,
            context.canReviseExamResults,
          );
          await tx
            .delete(examResultTable)
            .where(eq(examResultTable.id, result.id));
          return result;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
