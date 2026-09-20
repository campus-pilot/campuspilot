import { classTable } from '@campuspilot/db/schema/class';
import type {
  FinanceClassOverrides,
  FinanceSchemaConfig,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, eq } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  schoolSessionFinanceDtoSchema,
  schoolSessionFinanceInputSchema,
  updateSchoolSessionFinanceInputSchema,
} from './session-finance.dto';

type FinanceClass = { slug: string; label: string };

/**
 * Rejects stale or cross-school class slugs and prevents values from being
 * assigned to fee elements that are not explicitly configurable by class.
 */
function validateClassOverrides(
  financeConfig: FinanceSchemaConfig | null,
  classOverrides: FinanceClassOverrides,
  classes: FinanceClass[],
) {
  const classSlugs = new Set(classes.map(({ slug }) => slug));

  for (const [classSlug, values] of Object.entries(classOverrides)) {
    if (!classSlugs.has(classSlug)) {
      throw rpcError.badRequest(
        `Class "${classSlug}" does not belong to this school.`,
      );
    }

    for (const elementSlug of Object.keys(values)) {
      const element = financeConfig?.elements[elementSlug];
      if (!element) {
        throw rpcError.badRequest(
          `Finance element "${elementSlug}" is not defined for this session.`,
        );
      }
      if (!element.scopes.includes('class')) {
        throw rpcError.badRequest(
          `Finance element "${elementSlug}" cannot be overridden by class.`,
        );
      }
    }
  }
}

export const schoolSessionFinanceRouter = {
  getSessionFinance: protectedProcedure
    .route({
      summary: 'Get school session finance configuration',
      description:
        'Read the finance schema and class-level overrides for one academic session. This restricted DTO is intentionally separate from the general session resource.',
      tags: ['School', 'Session Finance'],
    })
    .input(schoolSessionFinanceInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_SESSION_FINANCE))
    .output(schoolSessionFinanceDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [[session], classes] = await Promise.all([
          context.db
            .select({
              schoolId: schoolSessionTable.schoolId,
              sessionId: schoolSessionTable.id,
              financeConfig: schoolSessionTable.financeConfig,
              classOverrides: schoolSessionTable.financeClassOverrides,
            })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.id, input.sessionId),
              ),
            )
            .limit(1),
          context.db
            .select({ slug: classTable.slug, label: classTable.label })
            .from(classTable)
            .where(eq(classTable.schoolId, input.schoolId))
            .orderBy(asc(classTable.label), asc(classTable.slug)),
        ]);
        if (!session) throw rpcError.notFound('School session');

        return schoolSessionFinanceDtoSchema.parse({ ...session, classes });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSessionFinance: protectedProcedure
    .route({
      summary: 'Update school session finance configuration',
      description:
        'Atomically update the restricted finance schema or class-level overrides for one academic session.',
      tags: ['School', 'Session Finance'],
    })
    .input(updateSchoolSessionFinanceInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_SESSION_FINANCE))
    .output(schoolSessionFinanceDtoSchema)
    .handler(async ({ context, input }) => {
      const { schoolId, sessionId } = input;

      try {
        return await context.db.transaction(async (transaction) => {
          const [session] = await transaction
            .select({
              financeConfig: schoolSessionTable.financeConfig,
              classOverrides: schoolSessionTable.financeClassOverrides,
            })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, schoolId),
                eq(schoolSessionTable.id, sessionId),
              ),
            )
            .for('update')
            .limit(1);
          if (!session) throw rpcError.notFound('School session');

          const classes = await transaction
            .select({ slug: classTable.slug, label: classTable.label })
            .from(classTable)
            .where(eq(classTable.schoolId, schoolId))
            .orderBy(asc(classTable.label), asc(classTable.slug));
          const financeConfig =
            input.financeConfig !== undefined
              ? input.financeConfig
              : session.financeConfig;
          const classOverrides =
            input.classOverrides !== undefined
              ? input.classOverrides
              : session.classOverrides;

          validateClassOverrides(financeConfig, classOverrides, classes);

          const [updated] = await transaction
            .update(schoolSessionTable)
            .set({
              financeConfig,
              financeClassOverrides: classOverrides,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schoolSessionTable.schoolId, schoolId),
                eq(schoolSessionTable.id, sessionId),
              ),
            )
            .returning({
              schoolId: schoolSessionTable.schoolId,
              sessionId: schoolSessionTable.id,
              financeConfig: schoolSessionTable.financeConfig,
              classOverrides: schoolSessionTable.financeClassOverrides,
            });
          if (!updated) throw rpcError.notFound('School session');

          return schoolSessionFinanceDtoSchema.parse({ ...updated, classes });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
