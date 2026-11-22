import { examOverview, examOverviews } from './exam-lifecycle.service';
import { and, asc, eq } from 'drizzle-orm';
import { classTable } from '@campuspilot/db/schema/class';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import {
  examNameKey,
  findExamNameClash,
  nextExamOrder,
} from '@campuspilot/db/schema/jsonb/session-config';
import { examClassTable, examPlanTable } from '@campuspilot/db/schema/exam';
import { assertExamsHaveNoData } from '../session/session-exam-removal';
import { detachExamsFromSubjects } from '../class/class-subject.service';
import { resolvePaginationInput } from '../../../paginations';
import { pageResult, route } from './exam.pagination';
import { examNameTakenError, getExam, getExamSession } from './exam.service';
import { examClassWhere, examWhere } from './exam.scope';
import { examContextSubjects } from './exam-context';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import { ORPCError } from '@orpc/server';
import { toRpcError } from '../../../errors';
import {
  EXAM_SLUG_TAKEN_MESSAGE,
  EXAM_SLUG_TAKEN_REASON,
  type ExamSlugTakenData,
} from './exam-definition.contract';
import * as dto from './exam.dto';

export const schoolExamDefinitionRouter = {
  listExams: protectedProcedure
    .route(
      route(
        'List session exams',
        'Read configured exam definitions, ordered by their explicit display order and slug.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
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
              input.orderBy.field === 'order'
                ? a.order - b.order
                : a[input.orderBy.field].localeCompare(b[input.orderBy.field]);
            return (
              (input.orderBy.direction === 'asc' ? primary : -primary) ||
              a.slug.localeCompare(b.slug)
            );
          });
        const { offset, pageSize } = resolvePaginationInput(input);
        const page = exams.slice(offset, offset + pageSize);
        const overviews = await examOverviews(
          context.db,
          input,
          page.map((exam) => exam.slug),
        );
        return pageResult(
          page.map((exam) => ({ ...exam, ...overviews.get(exam.slug)! })),
          exams.length,
          input,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getExamOverview: protectedProcedure
    .route(
      route(
        'Get examination lifecycle overview',
        'Read independent plan-generation count, explicitly controlled examination lifecycle and known start/completion timestamps. Generating a plan never starts the exam.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .output(dto.examOverviewSchema)
    .handler(async ({ context, input }) => {
      try {
        await getExam(context.db, input);
        return await examOverview(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getExam: protectedProcedure
    .route(
      route(
        'Get an exam',
        'Read one configured examination in a school session.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
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
        'Get exam configuration context',
        'Read the subjects taking part in the exam (those with a plan in it) and the assessment modes of their plans (slug, display name, percentage and maximum marks) for the classes taking part, attendance settings and co-scholastic areas for the exam workspace. Classes excluded from the exam are not listed; before the plan exists no class is.',
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
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .output(dto.examContextDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { session, exam } = await getExam(context.db, input);
        // Only the classes taking part: the timetable editor builds its
        // columns from these, so an excluded class is never offered there.
        const classes = await context.db
          .select({ class: classTable })
          .from(classTable)
          .innerJoin(
            examClassTable,
            and(
              examClassWhere(input),
              eq(examClassTable.classId, classTable.id),
            ),
          )
          .where(eq(classTable.schoolId, input.schoolId))
          .orderBy(asc(classTable.displayOrder), asc(classTable.id))
          .then((rows) => rows.map((row) => row.class));
        const plans = await context.db
          .select({ classId: examPlanTable.classId, subjectSlug: examPlanTable.subjectSlug, modeConfig: examPlanTable.modeConfig })
          .from(examPlanTable)
          .where(examWhere(input));
        return {
          exam,
          classes: classes.map((entry) => ({
            id: entry.id,
            label: entry.label,
            // Subjects taking part, with their plans' modes (`examContextSubjects`):
            // the timetable editor and other exam screens build their choices from this.
            subjects: examContextSubjects(
              entry.config.subjects,
              plans.filter((plan) => plan.classId === entry.id),
              input,
            ),
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
        'Create a session exam',
        'Add an exam with a slug and a name unique in the session to an active session, listed after the last exam unless an order is given. Names are compared ignoring case, spacing differences, invisible characters and Unicode compatibility forms. The slugs __proto__, constructor and prototype are reserved. School exam administrators only.',
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
    .input(dto.createExamInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_EXAM))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const session = await getExamSession(tx, input, 'update');
          if (Object.hasOwn(session.config.examConfig, input.examSlug))
            throw new ORPCError('CONFLICT', {
              message: EXAM_SLUG_TAKEN_MESSAGE,
              data: { reason: EXAM_SLUG_TAKEN_REASON } satisfies ExamSlugTakenData,
            });
          // Exam names are unique within the session (`examNameKey`).
          // The slug is checked first, so a request whose name derives a taken
          // slug keeps being refused as a taken slug.
          if (findExamNameClash(session.config.examConfig, input.name) !== undefined)
            throw examNameTakenError();
          // Read and written under the session row lock (FOR UPDATE), which the
          // full-config `updateSession` save takes too: concurrent creations and
          // saves run one after the other, each on the configuration the previous
          // one committed, so this never drops another exam.
          const exam = {
            name: input.name,
            order: input.order ?? nextExamOrder(session.config.examConfig),
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
  updateExam: protectedProcedure
    .route(
      route(
        'Update a session exam',
        'Edit the name and display order of an exam without changing its stable slug. A new name must not be used by another exam of the session (compared ignoring case, spacing differences, invisible characters and Unicode compatibility forms).',
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
    .input(dto.updateExamInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_EXAM))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session, exam: existing } = await getExam(
            tx,
            input,
            'update',
          );
          // A new name must not clash with another exam of the session. Keeping
          // the exam's own name, or changing only what `examNameKey` ignores
          // (case, spacing, invisible characters), does not introduce a clash
          // and is allowed, even when the session already stored a duplicate
          // of it.
          if (
            input.name !== undefined &&
            examNameKey(input.name) !== examNameKey(existing.name) &&
            findExamNameClash(session.config.examConfig, input.name, input.examSlug) !==
              undefined
          )
            throw examNameTakenError();
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
        'Delete a session exam',
        'Remove an exam definition that has no recorded data: refused (CONFLICT) while it has plans, results, a timetable, a working-day limit, student assessments or remarks, a started or completed lifecycle, a results notification record or question papers. Its record of the classes taking part and the subjects added only for it are removed with it.',
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
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_EXAM))
    .output(dto.examDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (tx) => {
          const { session, exam } = await getExam(tx, input, 'update');
          // The removal guard `updateSession` uses too: plans (and results),
          // a timetable, a set working-day limit, student assessments and
          // remarks, a lifecycle beyond the bare `ready` row, a results
          // notification record or question papers keep the exam. Checked
          // under the session row lock taken above.
          await assertExamsHaveNoData(
            tx,
            session.id,
            session.config.examConfig,
            [input.examSlug],
            'delete',
          );
          // Classes may still take part without plans (after deleting every
          // legacy plan); that selection belongs to the exam and goes with it.
          await tx.delete(examClassTable).where(examClassWhere(input));
          // Subjects added only for this exam go with it (it can have no
          // plans here, so none of them has one).
          await detachExamsFromSubjects(tx, input.schoolId, input.sessionId, [input.examSlug]);
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
