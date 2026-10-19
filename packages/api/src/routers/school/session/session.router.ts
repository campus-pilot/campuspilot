import { schoolSessionTable } from '@campuspilot/db/schema/session';
import {
  financeLedgerEntryTable,
  financeNumberCounterTable,
} from '@campuspilot/db/schema/finance';
import { examPlanTable, examTimetableTable } from '@campuspilot/db/schema/exam';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { resolveSessionExamPermission } from '../../../permissions/session-exams';
import { schoolTable } from '@campuspilot/db/schema/school';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

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

export const schoolSessionRouter = {
  listSessions: protectedProcedure
    .route({
      summary: 'List school sessions',
      description:
        "List a school's academic sessions with pagination, active-status filtering, and deterministic sorting. Requires permission to list sessions in that school.",
      tags: ['School', 'Sessions'],
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
        'Update explicitly supplied fields on the active academic session while validating year boundaries against stored values. Inactive sessions are read-only.',
      tags: ['School', 'Sessions'],
    })
    .input(updateSchoolSessionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_SESSION))
    .use(resolveSessionExamPermission(SCHOOL_ACTIONS.UPDATE_EXAM))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      const { schoolId, sessionId, ...changes } = input;
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
            // The exclusive session lock prevents concurrent plan/timetable creation
            // while a legacy full-config replacement validates retained exam slugs.
            const plans = await transaction
              .select({ examSlug: examPlanTable.examSlug })
              .from(examPlanTable)
              .where(eq(examPlanTable.sessionId, sessionId));
            const timetables = await transaction
              .select({ examSlug: examTimetableTable.examSlug })
              .from(examTimetableTable)
              .where(eq(examTimetableTable.sessionId, sessionId));
            if (
              [...plans, ...timetables].some(
                (row) => !Object.hasOwn(next.examConfig, row.examSlug),
              )
            )
              throw rpcError.conflict(
                'Exam definitions with existing plans or timetables cannot be removed.',
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
