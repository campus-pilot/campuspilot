import type { z } from "zod";
import type { DatabaseTransaction } from "@campuspilot/db";
import { and, eq, inArray } from "drizzle-orm";
import { classTable } from "@campuspilot/db/schema/class";
import { examPlanTable, examTimetableTable } from "@campuspilot/db/schema/exam";
import { route } from "./exam.pagination";
import { getExam } from "./exam.service";
import {
  publishExamTimetable,
  requireExamNotEnded,
  requireTimetableDraft,
  timetableWhere,
  withdrawExamTimetable,
} from "./exam-timetable.service";
import { handOffNotificationEvents } from "../../../notifications/notification.outbox";
import { previewTimetableDelivery } from "../../../notifications/emitters/exam-timetable";
import { timetablePublishPreviewSchema } from "./exam-result-notification.dto";
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
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "exams",
      },
    })
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
        "Create or replace the optional shared grid as a draft, validating school classes, configured subjects and modes, dates and non-overlapping local time slots. Refused while the timetable is published (withdraw it first) and once the exam has ended.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "exams",
      },
    })
    .input(dto.saveExamTimetableInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          await getExam(tx, input, "update");
          await assertTimetableEditable(tx, input);
          const [existing] = await tx.select().from(examTimetableTable).where(timetableWhere(input)).for("update");
          requireTimetableDraft(existing);
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
  previewExamTimetablePublish: protectedProcedure
    .route(
      route(
        "Preview publishing an exam timetable",
        "Count whom publishing the timetable would notify: every staff member and, while the school has the Cadet Portal, the per-channel forecast for its registered students. Writes nothing.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "exams",
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.PUBLISH_EXAM_TIMETABLE))
    .output(timetablePublishPreviewSchema)
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        return await previewTimetableDelivery(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  publishExamTimetable: protectedProcedure
    .route(
      route(
        "Publish an exam timetable",
        "Publish the draft timetable of an exam that has not ended: notify every staff member and, while the school has the Cadet Portal, all its registered students. A published timetable is frozen; withdraw it to a draft to change it. Publishing again after a withdrawal notifies again.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: false,
        module: "exams",
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.PUBLISH_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { timetable, eventIds } = await context.db.transaction((tx) =>
          publishExamTimetable(tx, input, context.session.user.id),
        );
        handOffNotificationEvents(eventIds);
        return timetable;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  withdrawExamTimetable: protectedProcedure
    .route(
      route(
        "Withdraw an exam timetable",
        "Return a published timetable to a draft so it can be edited: students stop seeing it and nobody is notified. Refused once the exam has ended.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "exams",
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.PUBLISH_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) => withdrawExamTimetable(tx, input));
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  deleteExamTimetable: protectedProcedure
    .route(
      route(
        "Delete an exam timetable",
        "Remove an optional shared timetable while it is a draft and the exam is still editable.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "exams",
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM_TIMETABLE))
    .output(dto.timetableDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          await getExam(tx, input, "update");
          await assertTimetableEditable(tx, input);
          const [existing] = await tx.select().from(examTimetableTable).where(timetableWhere(input)).for("update");
          requireTimetableDraft(existing);
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
/** A finished class plan or an ended exam freezes the shared exam schedule until reopened. */
async function assertTimetableEditable(
  tx: DatabaseTransaction,
  input: z.infer<typeof dto.examScopeSchema>,
) {
  await requireExamNotEnded(tx, input);
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
