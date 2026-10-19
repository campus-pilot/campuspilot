import { admissionTable } from '@campuspilot/db/schema/admission';
import { classTable } from '@campuspilot/db/schema/class';
import { financeLedgerEntryTable } from '@campuspilot/db/schema/finance';
import type {
  FinanceClassOverrides,
  FinanceValuesMap,
  PersistedFinanceSchemaConfig,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '@campuspilot/db';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  getFinanceConfigurationReadiness,
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
  financeConfig: PersistedFinanceSchemaConfig | null,
  classOverrides: FinanceClassOverrides,
  classes: FinanceClass[],
) {
  if (Object.values(classOverrides).some((values) => Object.keys(values).length > 0) && !financeConfig?.currency) {
    throw rpcError.badRequest('Choose a supported currency before setting class finance amounts.');
  }
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

function validateAdmissionOverrides(
  financeConfig: PersistedFinanceSchemaConfig | null,
  admissionOverrides: Array<{ admissionId: string; values: FinanceValuesMap }>,
) {
  for (const { admissionId, values } of admissionOverrides) {
    for (const elementSlug of Object.keys(values)) {
      const element = financeConfig?.elements[elementSlug];
      if (!element) {
        throw rpcError.conflict(
          `Finance element "${elementSlug}" is still used by admission ${admissionId}. Remove that override before removing or renaming the element.`,
        );
      }
      if (!element.scopes.includes('student')) {
        throw rpcError.conflict(
          `Finance element "${elementSlug}" is still used by admission ${admissionId} and cannot remove admission scope.`,
        );
      }
    }
  }
}

async function readAdmissionOverrides(
  db: DatabaseExecutor,
  schoolId: string,
  sessionId: string,
) {
  const rows = await db
    .select({
      admissionId: admissionTable.id,
      financeValue: admissionTable.financeValue,
    })
    .from(admissionTable)
    .where(
      and(
        eq(admissionTable.schoolId, schoolId),
        sql`${admissionTable.financeValue} ? ${sessionId}`,
      ),
    );
  return rows.map(({ admissionId, financeValue }) => ({
    admissionId,
    values: financeValue[sessionId] ?? {},
  }));
}

/**
 * Currency conversion is intentionally not an implicit side effect of a
 * configuration edit. Once any amount exists, a future reviewed conversion or
 * reset command must change currency and all dependent facts atomically.
 */
async function assertCurrencyCanChange(
  db: DatabaseExecutor,
  input: {
    schoolId: string;
    sessionId: string;
    currentConfig: PersistedFinanceSchemaConfig | null;
    nextConfig: PersistedFinanceSchemaConfig | null;
    classOverrides: FinanceClassOverrides;
    admissionOverrides: Array<{ values: FinanceValuesMap }>;
  },
) {
  const currentCurrency = input.currentConfig?.currency;
  const nextCurrency = input.nextConfig?.currency;
  if (currentCurrency === nextCurrency) return;

  const hasBaseAmounts = Object.values(
    input.currentConfig?.elements ?? {},
  ).some(({ defaultAmountMinor }) => defaultAmountMinor !== undefined);
  const hasClassAmounts = Object.values(input.classOverrides).some(
    (values) => Object.keys(values).length > 0,
  );
  const hasAdmissionAmounts = input.admissionOverrides.some(
    ({ values }) => Object.keys(values).length > 0,
  );
  const [postedFact] = await db
    .select({ id: financeLedgerEntryTable.id })
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, input.schoolId),
        eq(financeLedgerEntryTable.sessionId, input.sessionId),
      ),
    )
    .limit(1);

  if (
    hasBaseAmounts ||
    hasClassAmounts ||
    hasAdmissionAmounts ||
    postedFact
  ) {
    throw rpcError.conflict(
      'Currency cannot change while configured amounts or posted finance facts exist. A reviewed conversion or reset flow is required.',
    );
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

        return schoolSessionFinanceDtoSchema.parse({
          ...session,
          classes,
          configurationReadiness: getFinanceConfigurationReadiness(
            session.financeConfig,
          ),
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSessionFinance: protectedProcedure
    .route({
      summary: 'Update school session finance configuration',
      description:
        'Atomically update the restricted finance schema or class-level overrides for the active academic session. Inactive sessions are read-only.',
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
              isActive: schoolSessionTable.isActive,
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
          if (!session.isActive) {
            throw rpcError.conflict(
              'Only the active academic session can be updated.',
            );
          }

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
          const admissionOverrides = await readAdmissionOverrides(
            transaction,
            schoolId,
            sessionId,
          );

          validateClassOverrides(financeConfig, classOverrides, classes);
          validateAdmissionOverrides(financeConfig, admissionOverrides);
          await assertCurrencyCanChange(transaction, {
            schoolId,
            sessionId,
            currentConfig: session.financeConfig,
            nextConfig: financeConfig,
            classOverrides: session.classOverrides,
            admissionOverrides,
          });

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

          return schoolSessionFinanceDtoSchema.parse({
            ...updated,
            classes,
            configurationReadiness: getFinanceConfigurationReadiness(
              updated.financeConfig,
            ),
          });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
