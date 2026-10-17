import type { z } from "zod";
import type { DatabaseTransaction } from "@campuspilot/db";
import { and, eq, inArray } from "drizzle-orm";
import { classTable } from "@campuspilot/db/schema/class";
import { examPlanTable, examTimetableTable } from "@campuspilot/db/schema/exam";
import { route } from "./exam.pagination";
import { getExam } from "./exam.service";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import { rpcError, toRpcError } from "../../../errors";
import * as dto from "./exam.dto";

export const schoolExamTimetableRouter = {
  getExamTimetable: protectedProcedure
    .route(
      route(
        "Get an exam timetable",
        "Read the optional shared date and local-time grid for an exam. Absence is returned explicitly as null.",
      ),
    )
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema.nullable())
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        const [timetable] = await context.db
          .select()
          .from(examTimetableTable)
          .where(
            and(
              eq(examTimetableTable.schoolId, input.schoolId),
              eq(examTimetableTable.sessionId, input.sessionId),
              eq(examTimetableTable.examSlug, input.examSlug),
            ),
          )
          .limit(1);
        return timetable ?? null;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  saveExamTimetable: protectedProcedure
    .route(
      route(
        "Save an exam timetable",
        "Create or replace the optional shared grid, validating school classes, configured subjects and modes, dates and non-overlapping local time slots. Completed exams are read-only.",
      ),
    )
    .input(dto.saveExamTimetableInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          await getExam(tx, input, "update");
          await assertTimetableEditable(tx, input);
          const classes = input.config.columns.length
            ? await tx
                .select()
                .from(classTable)
                .where(
                  and(
                    eq(classTable.schoolId, input.schoolId),
                    inArray(classTable.id, input.config.columns),
                  ),
                )
            : [];
          if (classes.length !== input.config.columns.length)
            throw rpcError.badRequest(
              "Every timetable column must be a class in this school.",
            );
          const byId = new Map(classes.map((entry) => [entry.id, entry]));
          for (const row of input.config.rows)
            for (const [classId, cell] of Object.entries(row.cells)) {
              for (const entry of cell === null
                ? []
                : Array.isArray(cell)
                  ? cell
                  : [cell]) {
                const subjects = byId.get(classId)?.config.subjects;
                const subject =
                  subjects && Object.hasOwn(subjects, entry.subjectSlug)
                    ? subjects[entry.subjectSlug]
                    : undefined;
                if (
                  !subject ||
                  !Object.hasOwn(subject.examModes, entry.modeSlug)
                )
                  throw rpcError.badRequest(
                    "Each timetable cell must use a subject and mode configured for its class.",
                  );
              }
            }
          const [saved] = await tx
            .insert(examTimetableTable)
            .values(input)
            .onConflictDoUpdate({
              target: [
                examTimetableTable.sessionId,
                examTimetableTable.examSlug,
              ],
              set: { config: input.config, updatedAt: new Date() },
            })
            .returning();
          return saved!;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  deleteExamTimetable: protectedProcedure
    .route(
      route(
        "Delete an exam timetable",
        "Remove an optional shared timetable while the exam is still editable.",
      ),
    )
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          await getExam(tx, input, "update");
          await assertTimetableEditable(tx, input);
          const [deleted] = await tx
            .delete(examTimetableTable)
            .where(
              and(
                eq(examTimetableTable.schoolId, input.schoolId),
                eq(examTimetableTable.sessionId, input.sessionId),
                eq(examTimetableTable.examSlug, input.examSlug),
              ),
            )
            .returning();
          if (!deleted) throw rpcError.notFound("Exam timetable");
          return deleted;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
/** A finished class plan freezes the shared exam schedule until reopened. */
async function assertTimetableEditable(
  tx: DatabaseTransaction,
  input: z.infer<typeof dto.examScopeSchema>,
) {
  const [completed] = await tx
    .select({ id: examPlanTable.id })
    .from(examPlanTable)
    .where(
      and(
        eq(examPlanTable.sessionId, input.sessionId),
        eq(examPlanTable.examSlug, input.examSlug),
        eq(examPlanTable.status, "completed"),
      ),
    )
    .limit(1);
  if (completed)
    throw rpcError.badRequest(
      "Reopen completed exam plans before modifying the shared timetable.",
    );
}
