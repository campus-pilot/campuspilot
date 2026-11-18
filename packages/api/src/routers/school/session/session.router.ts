import { schoolSessionTable } from '@campuspilot/db/schema/session';
import {
  financeLedgerEntryTable,
  financeNumberCounterTable,
} from '@campuspilot/db/schema/finance';
import { examClassTable } from '@campuspilot/db/schema/exam';
import {
  findIntroducedExamNameClashes,
  sessionConfigSchema,
} from '@campuspilot/db/schema/jsonb/session-config';
import { examNameTakenError } from '../exam/exam.service';
import { ORPCError } from '@orpc/server';
import {
  SESSION_STALE_MESSAGE,
  SESSION_STALE_REASON,
  sessionVersionToken,
  type SessionStaleData,
} from './session.contract';
import { assertNoExamWithDataRemoved } from './session-exam-removal';
import { resolveSessionExamPermission } from '../../../permissions/session-exams';
import { schoolTable } from '@campuspilot/db/schema/school';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import type { DatabaseExecutor } from '@campuspilot/db';
import { assertSchoolFeatureEnabled } from '../../../feature-flags/feature-flags.service';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from '../../../paginations';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  createSchoolSessionInputSchema,
  listSchoolSessionsInputSchema,
  listSchoolSessionsOutputSchema,
  schoolSessionDtoSchema,
  schoolSessionIdInputSchema,
  sessionFilterOptionsOutputSchema,
  toSchoolSessionDto,
  updateSchoolSessionInputSchema,
} from './session.dto';

const schoolSessionDtoColumns = {
  id: schoolSessionTable.id,
  schoolId: schoolSessionTable.schoolId,
  sessionStartYear: schoolSessionTable.sessionStartYear,
  sessionEndYear: schoolSessionTable.sessionEndYear,
  sessionConfig: schoolSessionTable.sessionConfig,
  isActive: schoolSessionTable.isActive,
  createdAt: schoolSessionTable.createdAt,
  updatedAt: schoolSessionTable.updatedAt,
};

/** The parts of a session's configuration that only matter for students' results. */
const STUDENT_SESSION_SETTINGS = ['coScholasticAreas', 'gradingScale', 'attendanceTracking'] as const;

/**
 * Refuses a session configuration that changes a student-only setting
 * (co-scholastic areas, the grading scale, attendance) in a school without
 * student management, with the disabled-feature error. `stored` is the
 * configuration being replaced, or null for a new session, which may only
 * carry those settings' defaults. Both sides are read through the schema
 * first, so defaults equal defaults: the staff-only settings screen resubmits
 * the hidden parts as it received them (or as defaults for a session that
 * stored none) and is never refused. Examination definitions are not
 * student-only and are not looked at here.
 */
async function assertStudentSessionSettingsUnchanged(
  db: DatabaseExecutor,
  schoolId: string,
  stored: unknown,
  submitted: unknown,
): Promise<void> {
  const previous = sessionConfigSchema.parse(stored ?? {});
  const next = sessionConfigSchema.parse(submitted ?? {});
  if (STUDENT_SESSION_SETTINGS.every((key) => isDeepStrictEqual(previous[key], next[key]))) return;
  await assertSchoolFeatureEnabled(db, schoolId, 'studentManagement');
}

/**
 * Refuses a session configuration whose exams introduce a name clash (exam
 * names are unique within a session, `examNameKey`) with the taken-name
 * CONFLICT (`isExamNameTakenError`). `stored` is the configuration being
 * replaced, or null for a new session, where every exam is new.
 *
 * The rule lives here, where configurations are written, rather than as a
 * refinement of `examConfigSchema`: that schema also parses configurations
 * read from the database and the session DTOs, and sessions saved before
 * names had to be unique may hold duplicates. A refinement would make them
 * unreadable, and would refuse every save of such a session, even of
 * unrelated settings. Comparing with the stored configuration instead refuses
 * only clashes the submission introduces (an exam that is new or renamed,
 * `findIntroducedExamNameClashes`), so stored duplicates keep saving.
 */
function assertNoIntroducedExamNameClash(stored: unknown, submitted: unknown) {
  const previous = sessionConfigSchema.parse(stored ?? {});
  const next = sessionConfigSchema.parse(submitted ?? {});
  if (findIntroducedExamNameClashes(previous.examConfig, next.examConfig).length)
    throw examNameTakenError();
}

export const schoolSessionRouter = {
  listSessions: protectedProcedure
    .route({
      summary: 'List school sessions',
      description:
        "List a school's academic sessions with pagination, active-status filtering, and deterministic sorting. Requires permission to list sessions in that school.",
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'sessions',
      },
    })
    .input(listSchoolSessionsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_SESSIONS))
    .output(listSchoolSessionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const activeCondition =
          input.filters?.isActive === undefined
            ? undefined
            : eq(schoolSessionTable.isActive, input.filters.isActive);
        const startYearCondition =
          input.filters?.startYears && input.filters.startYears.length > 0
            ? inArray(
                schoolSessionTable.sessionStartYear,
                input.filters.startYears,
              )
            : undefined;
        const endYearCondition =
          input.filters?.endYears && input.filters.endYears.length > 0
            ? inArray(schoolSessionTable.sessionEndYear, input.filters.endYears)
            : undefined;
        const where = and(
          eq(schoolSessionTable.schoolId, input.schoolId),
          activeCondition,
          startYearCondition,
          endYearCondition,
        );

        const orderByColumn = {
          sessionStartYear: schoolSessionTable.sessionStartYear,
          sessionEndYear: schoolSessionTable.sessionEndYear,
          createdAt: schoolSessionTable.createdAt,
          updatedAt: schoolSessionTable.updatedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === 'asc' ? asc : desc;

        const [sessions, totalRows] = await Promise.all([
          context.db
            .select(schoolSessionDtoColumns)
            .from(schoolSessionTable)
            .where(where)
            .orderBy(
              orderDirection(orderByColumn),
              orderDirection(schoolSessionTable.id),
            )
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(schoolSessionTable)
            .where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: sessions.map(toSchoolSessionDto),
          nextCursor: createNextPageCursor(currentPage, totalPages),
          currentPage,
          totalPages,
          totalItems,
          pageSize,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getSession: protectedProcedure
    .route({
      summary: 'Get a school session',
      description:
        'Get one academic session by school and session identifier. Requires permission to read sessions in that school.',
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'sessions',
      },
    })
    .input(schoolSessionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_SESSION))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [session] = await context.db
          .select(schoolSessionDtoColumns)
          .from(schoolSessionTable)
          .where(
            and(
              eq(schoolSessionTable.schoolId, input.schoolId),
              eq(schoolSessionTable.id, input.sessionId),
            ),
          )
          .limit(1);
        if (!session) throw rpcError.notFound('School session');
        return toSchoolSessionDto(session);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createSession: protectedProcedure
    .route({
      summary: 'Create a school session',
      description:
        'Create an academic session for a school with explicit year boundaries and optional academic configuration. Finance configuration is managed through its dedicated restricted routes.',
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: false,
        module: 'sessions',
      },
    })
    .input(createSchoolSessionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_SESSION))
    .use(resolveSessionExamPermission(SCHOOL_ACTIONS.CREATE_EXAM))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { schoolId, ...values } = input;
        if (
          Object.keys(values.sessionConfig?.examConfig ?? {}).length &&
          !context.canManageSessionExams
        ) {
          throw rpcError.forbidden(
            'Only school exam administrators can create exam definitions, including through session configuration.',
          );
        }
        const [school] = await context.db
          .select({ id: schoolTable.id })
          .from(schoolTable)
          .where(eq(schoolTable.id, schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound('School');
        await assertStudentSessionSettingsUnchanged(context.db, schoolId, null, values.sessionConfig);
        assertNoIntroducedExamNameClash(null, values.sessionConfig);

        const [session] = await context.db
          .insert(schoolSessionTable)
          .values({ schoolId, ...values })
          .returning(schoolSessionDtoColumns);
        if (!session) throw rpcError.internal();
        return toSchoolSessionDto(session);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSession: protectedProcedure
    .route({
      summary: 'Update a school session',
      description:
        "Update explicitly supplied fields on the active academic session while validating year boundaries against stored values. Inactive sessions are read-only. sessionConfig replaces the whole configuration, including every exam definition: an exam left out is removed, which is refused (CONFLICT) for an exam with plans, a timetable, results, question papers or other recorded data. Send expectedUpdatedAt (the session's updatedAt from getSession) to have the update refused with CONFLICT (data.reason 'SESSION_STALE') instead of overwriting changes made since that read; it is optional, and without it the update applies to whatever is stored.",
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'sessions',
      },
    })
    .input(updateSchoolSessionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_SESSION))
    .use(resolveSessionExamPermission(SCHOOL_ACTIONS.UPDATE_EXAM))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      const { schoolId, sessionId, expectedUpdatedAt, ...changes } = input;
      try {
        return await context.db.transaction(async (transaction) => {
          const [existingSession] = await transaction
            .select()
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, schoolId),
                eq(schoolSessionTable.id, sessionId),
              ),
            )
            .for('update')
            .limit(1);
          if (!existingSession) throw rpcError.notFound('School session');
          if (!existingSession.isActive)
            throw rpcError.conflict(
              'Only the active academic session can be updated.',
            );
          // Optimistic concurrency, checked first, against the row read under
          // the lock that every exam definition write (`createExam`,
          // `updateExam`, `deleteExam`) also takes and that each of them
          // bumps `updatedAt` under. Optional: without the token the update
          // applies to whatever is stored (MCP and other callers that do not
          // edit an earlier copy). Because it is checked before every other
          // rule, any later refusal (a taken name, an exam with data) is about
          // the caller's own edit of the current configuration, not about a
          // change made elsewhere. Two writes within one millisecond would
          // share a token; every writer sets `updatedAt` from the clock under
          // this lock, so that needs two writes in the same millisecond.
          if (
            expectedUpdatedAt !== undefined &&
            sessionVersionToken(expectedUpdatedAt) !==
              sessionVersionToken(existingSession.updatedAt)
          )
            throw new ORPCError('CONFLICT', {
              message: SESSION_STALE_MESSAGE,
              data: { reason: SESSION_STALE_REASON } satisfies SessionStaleData,
            });
          const sessionStartYear =
            changes.sessionStartYear ?? existingSession.sessionStartYear;
          const sessionEndYear =
            changes.sessionEndYear ?? existingSession.sessionEndYear;
          if (sessionEndYear <= sessionStartYear)
            throw rpcError.badRequest(
              'Session end year must be after its start year.',
            );
          const yearsChanged =
            sessionStartYear !== existingSession.sessionStartYear ||
            sessionEndYear !== existingSession.sessionEndYear;
          if (yearsChanged) {
            const [history] = await transaction
              .select({ id: schoolSessionTable.id })
              .from(schoolSessionTable)
              .leftJoin(
                financeNumberCounterTable,
                eq(financeNumberCounterTable.sessionId, schoolSessionTable.id),
              )
              .leftJoin(
                financeLedgerEntryTable,
                eq(financeLedgerEntryTable.sessionId, schoolSessionTable.id),
              )
              .where(
                and(
                  eq(schoolSessionTable.id, sessionId),
                  or(
                    sql`${financeNumberCounterTable.sessionId} is not null`,
                    sql`${financeLedgerEntryTable.sessionId} is not null`,
                  ),
                ),
              )
              .limit(1);
            if (history) {
              throw rpcError.conflict(
                'Session years cannot change after finance numbering or posting history exists.',
              );
            }
          }
          if (changes.sessionConfig !== undefined) {
            const previous = sessionConfigSchema.parse(
              existingSession.sessionConfig ?? {},
            );
            const next = sessionConfigSchema.parse(changes.sessionConfig ?? {});
            const sameExams =
              Object.keys(previous.examConfig).length ===
                Object.keys(next.examConfig).length &&
              Object.entries(previous.examConfig).every(
                ([slug, exam]) =>
                  next.examConfig[slug]?.name === exam.name &&
                  next.examConfig[slug]?.order === exam.order,
              );
            if (!sameExams && !context.canManageSessionExams)
              throw rpcError.forbidden(
                'Only school exam administrators can change exam definitions, including through session configuration.',
              );
            await assertStudentSessionSettingsUnchanged(
              transaction,
              schoolId,
              existingSession.sessionConfig,
              changes.sessionConfig,
            );
            // Compared with the configuration read under the session row lock,
            // which `createExam` and `updateExam` also take.
            assertNoIntroducedExamNameClash(
              existingSession.sessionConfig,
              changes.sessionConfig,
            );
            // A full replacement removes every exam it leaves out, including
            // the old slug of an exam whose slug was changed in settings.
            // Refused while the removed slug has recorded data; checked under
            // the session row lock taken above.
            await assertNoExamWithDataRemoved(
              transaction,
              sessionId,
              previous.examConfig,
              next.examConfig,
            );
            // A removed exam's class selection goes with it, as in deleteExam.
            // Runs only after the guard above passed. `exam_class` rows do not
            // block a removal: they exist alongside plans (which do), except
            // for a legacy exam whose plans were deleted, where they are
            // leftovers of the selection, not recorded data.
            const removedExamSlugs = Object.keys(previous.examConfig).filter(
              (slug) => !Object.hasOwn(next.examConfig, slug),
            );
            if (removedExamSlugs.length)
              await transaction
                .delete(examClassTable)
                .where(
                  and(
                    eq(examClassTable.sessionId, sessionId),
                    inArray(examClassTable.examSlug, removedExamSlugs),
                  ),
                );
          }
          const [session] = await transaction
            .update(schoolSessionTable)
            .set({ ...changes, updatedAt: new Date() })
            .where(
              and(
                eq(schoolSessionTable.schoolId, schoolId),
                eq(schoolSessionTable.id, sessionId),
                eq(schoolSessionTable.isActive, true),
              ),
            )
            .returning(schoolSessionDtoColumns);
          if (!session)
            throw rpcError.conflict(
              'Only the active academic session can be updated.',
            );
          return toSchoolSessionDto(session);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteSession: protectedProcedure
    .route({
      summary: 'Delete a school session',
      description:
        'Permanently delete an inactive academic session from a school. The active session must be replaced before it can be deleted.',
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'sessions',
      },
    })
    .input(schoolSessionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_SESSION))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [session] = await context.db
          .delete(schoolSessionTable)
          .where(
            and(
              eq(schoolSessionTable.schoolId, input.schoolId),
              eq(schoolSessionTable.id, input.sessionId),
              eq(schoolSessionTable.isActive, false),
            ),
          )
          .returning(schoolSessionDtoColumns);
        if (!session) {
          // A failed conditional delete can mean either a missing session or
          // an active one; resolve those states explicitly for stable clients.
          const [existingSession] = await context.db
            .select({ isActive: schoolSessionTable.isActive })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.id, input.sessionId),
              ),
            )
            .limit(1);
          if (!existingSession) throw rpcError.notFound('School session');
          throw rpcError.conflict(
            'The active academic session cannot be deleted. Activate another session first.',
          );
        }
        return toSchoolSessionDto(session);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  activateSession: protectedProcedure
    .route({
      summary: 'Activate a school session',
      description:
        "Atomically activate one academic session and deactivate the school's currently active session.",
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'sessions',
      },
    })
    .input(schoolSessionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.ACTIVATE_SESSION))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Locking the school serializes competing activations before the
          // current active flag is cleared and the requested one is selected.
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .for('update')
            .limit(1);
          if (!school) throw rpcError.notFound('School');

          const [targetSession] = await transaction
            .select({ id: schoolSessionTable.id })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.id, input.sessionId),
              ),
            )
            .limit(1);
          if (!targetSession) throw rpcError.notFound('School session');

          const activatedAt = new Date();
          await transaction
            .update(schoolSessionTable)
            .set({ isActive: false, updatedAt: activatedAt })
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.isActive, true),
              ),
            );

          const [session] = await transaction
            .update(schoolSessionTable)
            .set({ isActive: true, updatedAt: activatedAt })
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.id, input.sessionId),
              ),
            )
            .returning(schoolSessionDtoColumns);
          if (!session) throw rpcError.notFound('School session');
          return toSchoolSessionDto(session);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listSessionFilterOptions: protectedProcedure
    .route({
      summary: 'List available session filter options',
      description:
        'List distinct start and end years for academic sessions within a school. Requires permission to list sessions in that school.',
      tags: ['School', 'Sessions'],
    })
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'read',
        destructive: false,
        module: 'sessions',
      },
    })
    .input(z.object({ schoolId: z.string().min(1) }))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_SESSIONS))
    .output(sessionFilterOptionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const rows = await context.db
          .select({
            sessionStartYear: schoolSessionTable.sessionStartYear,
            sessionEndYear: schoolSessionTable.sessionEndYear,
          })
          .from(schoolSessionTable)
          .where(eq(schoolSessionTable.schoolId, input.schoolId))
          .orderBy(desc(schoolSessionTable.sessionStartYear));

        const startYears = Array.from(
          new Set(rows.map((r) => r.sessionStartYear)),
        ).sort((a, b) => b - a);
        const endYears = Array.from(
          new Set(rows.map((r) => r.sessionEndYear)),
        ).sort((a, b) => b - a);

        return { startYears, endYears };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
