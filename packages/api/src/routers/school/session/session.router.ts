import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { schoolTable } from '@campuspilot/db/schema/school';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, count, desc, eq } from 'drizzle-orm';

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
  toSchoolSessionDto,
  updateSchoolSessionInputSchema,
} from './session.dto';

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
        const where = and(
          eq(schoolSessionTable.schoolId, input.schoolId),
          activeCondition,
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
            .select()
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
          .select()
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
        'Create an academic session for a school with explicit year boundaries and optional session and finance configuration. Requires permission to create sessions in that school.',
      tags: ['School', 'Sessions'],
    })
    .input(createSchoolSessionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_SESSION))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { schoolId, ...values } = input;
        const [school] = await context.db
          .select({ id: schoolTable.id })
          .from(schoolTable)
          .where(eq(schoolTable.id, schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound('School');

        const [session] = await context.db
          .insert(schoolSessionTable)
          .values({ schoolId, ...values })
          .returning();
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
        'Update explicitly supplied academic-session fields while validating year boundaries against stored values. Requires permission to update sessions in that school.',
      tags: ['School', 'Sessions'],
    })
    .input(updateSchoolSessionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_SESSION))
    .output(schoolSessionDtoSchema)
    .handler(async ({ context, input }) => {
      const { schoolId, sessionId, ...changes } = input;
      try {
        const [existingSession] = await context.db
          .select({
            sessionStartYear: schoolSessionTable.sessionStartYear,
            sessionEndYear: schoolSessionTable.sessionEndYear,
          })
          .from(schoolSessionTable)
          .where(
            and(
              eq(schoolSessionTable.schoolId, schoolId),
              eq(schoolSessionTable.id, sessionId),
            ),
          )
          .limit(1);
        if (!existingSession) throw rpcError.notFound('School session');

        // Partial year updates are validated against the stored counterpart so
        // the API never infers one academic boundary from the other.
        const sessionStartYear =
          changes.sessionStartYear ?? existingSession.sessionStartYear;
        const sessionEndYear =
          changes.sessionEndYear ?? existingSession.sessionEndYear;
        if (sessionEndYear <= sessionStartYear) {
          throw rpcError.badRequest(
            'Session end year must be after its start year.',
          );
        }

        const [session] = await context.db
          .update(schoolSessionTable)
          .set({ ...changes, updatedAt: new Date() })
          .where(
            and(
              eq(schoolSessionTable.schoolId, schoolId),
              eq(schoolSessionTable.id, sessionId),
            ),
          )
          .returning();
        if (!session) throw rpcError.notFound('School session');
        return toSchoolSessionDto(session);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteSession: protectedProcedure
    .route({
      summary: 'Delete a school session',
      description:
        'Permanently delete an academic session from a school. Requires permission to delete sessions in that school.',
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
            ),
          )
          .returning();
        if (!session) throw rpcError.notFound('School session');
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
            .returning();
          if (!session) throw rpcError.notFound('School session');
          return toSchoolSessionDto(session);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
