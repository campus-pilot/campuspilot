import { and, asc, eq } from "drizzle-orm";
import { classTable } from "@campuspilot/db/schema/class";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { examPlanTable, examTimetableTable } from "@campuspilot/db/schema/exam";
import { resolvePaginationInput } from "../../../paginations";
import { pageResult, route } from "./exam.pagination";
import { getExam, getExamSession } from "./exam.service";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import { rpcError, toRpcError } from "../../../errors";
import * as dto from "./exam.dto";

export const schoolExamDefinitionRouter = {
  listExams: protectedProcedure
    .route(
      route(
        "List session exams",
        "Read configured exam definitions, ordered by their explicit display order and slug.",
      ),
    )
    .input(dto.listExamsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .output(dto.listExamsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const session = await getExamSession(context.db, input);
        const exams = Object.entries(session.config.examConfig)
          .map(([slug, exam]) => ({ slug, ...exam }))
          .sort((a, b) => {
            const primary =
              input.orderBy.field === "order"
                ? a.order - b.order
                : a[input.orderBy.field].localeCompare(b[input.orderBy.field]);
            return (
              (input.orderBy.direction === "asc" ? primary : -primary) ||
              a.slug.localeCompare(b.slug)
            );
          });
        const { offset, pageSize } = resolvePaginationInput(input);
        return pageResult(
          exams.slice(offset, offset + pageSize),
          exams.length,
          input,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getExam: protectedProcedure
    .route(
      route(
        "Get an exam",
        "Read one configured examination in a school session.",
      ),
    )
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return (await getExam(context.db, input)).exam;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getExamContext: protectedProcedure
    .route(
      route(
        "Get exam configuration context",
        "Read class subjects and assessment modes, attendance settings and co-scholastic areas for the exam workspace.",
      ),
    )
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .output(dto.examContextDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { session, exam } = await getExam(context.db, input);
        const classes = await context.db
          .select()
          .from(classTable)
          .where(eq(classTable.schoolId, input.schoolId))
          .orderBy(asc(classTable.displayOrder), asc(classTable.id));
        return {
          exam,
          classes: classes.map((entry) => ({
            id: entry.id,
            label: entry.label,
            subjects: entry.config.subjects,
          })),
          coScholasticAreas: session.config.coScholasticAreas,
          attendanceTracking: session.config.attendanceTracking,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  createExam: protectedProcedure
    .route(
      route(
        "Create a session exam",
        "Add a unique exam slug and definition to an active session. School exam administrators only.",
      ),
    )
    .input(dto.createExamInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const session = await getExamSession(tx, input, "update");
          if (Object.hasOwn(session.config.examConfig, input.examSlug))
            throw rpcError.conflict(
              "An exam with this slug already exists in the session.",
            );
          const exam = { name: input.name, order: input.order };
          await tx
            .update(schoolSessionTable)
            .set({
              sessionConfig: {
                ...session.config,
                examConfig: {
                  ...session.config.examConfig,
                  [input.examSlug]: exam,
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(schoolSessionTable.id, session.id));
          return { slug: input.examSlug, ...exam };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  updateExam: protectedProcedure
    .route(
      route(
        "Update a session exam",
        "Edit the name and display order of an exam without changing its stable slug.",
      ),
    )
    .input(dto.updateExamInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session, exam: existing } = await getExam(
            tx,
            input,
            "update",
          );
          const exam = {
            name: input.name ?? existing.name,
            order: input.order ?? existing.order,
          };
          await tx
            .update(schoolSessionTable)
            .set({
              sessionConfig: {
                ...session.config,
                examConfig: {
                  ...session.config.examConfig,
                  [input.examSlug]: exam,
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(schoolSessionTable.id, session.id));
          return { slug: input.examSlug, ...exam };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  deleteExam: protectedProcedure
    .route(
      route(
        "Delete a session exam",
        "Remove an exam definition only after all its plans and optional timetable have been deleted.",
      ),
    )
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session, exam } = await getExam(tx, input, "update");
          const [plan] = await tx
            .select({ id: examPlanTable.id })
            .from(examPlanTable)
            .where(
              and(
                eq(examPlanTable.sessionId, session.id),
                eq(examPlanTable.examSlug, input.examSlug),
              ),
            )
            .limit(1);
          const [timetable] = await tx
            .select({ id: examTimetableTable.id })
            .from(examTimetableTable)
            .where(
              and(
                eq(examTimetableTable.sessionId, session.id),
                eq(examTimetableTable.examSlug, input.examSlug),
              ),
            )
            .limit(1);
          if (plan || timetable)
            throw rpcError.conflict(
              "Delete this exam’s plans and timetable before deleting the exam.",
            );
          const examConfig = { ...session.config.examConfig };
          delete examConfig[input.examSlug];
          await tx
            .update(schoolSessionTable)
            .set({
              sessionConfig: { ...session.config, examConfig },
              updatedAt: new Date(),
            })
            .where(eq(schoolSessionTable.id, session.id));
          return exam;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
