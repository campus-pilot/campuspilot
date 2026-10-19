import { admissionTable } from '@campuspilot/db/schema/admission';
import type {
  FinanceSchemaConfig,
  FinanceValuesMap,
  StudentFinanceValuesMap,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { and, eq } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import {
  admissionFinanceDtoSchema,
  admissionFinanceInputSchema,
  updateAdmissionFinanceInputSchema,
} from './admission-finance.dto';

/**
 * Admission pricing uses the legacy `student` scope name until the exact-money
 * configuration migration renames that persisted contract. The account owner
 * is still the durable admission, never a session enrollment.
 */
function validateAdmissionValues(
  financeConfig: FinanceSchemaConfig | null,
  values: FinanceValuesMap,
) {
  for (const elementSlug of Object.keys(values)) {
    const element = financeConfig?.elements[elementSlug];
    if (!element) {
      throw rpcError.badRequest(
        `Finance element "${elementSlug}" is not defined for this session.`,
      );
    }
    if (!element.scopes.includes('student')) {
      throw rpcError.badRequest(
        `Finance element "${elementSlug}" cannot be overridden by admission.`,
      );
    }
  }
}

export const admissionFinanceRouter = {
  getAdmissionFinanceValues: protectedProcedure
    .route({
      summary: 'Get admission finance values',
      description:
        'Read restricted admission-level pricing overrides for one explicit academic session.',
      tags: ['School', 'Billing'],
    })
    .input(admissionFinanceInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_FINANCE))
    .output(admissionFinanceDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [[admission], [session]] = await Promise.all([
          context.db
            .select({ financeValue: admissionTable.financeValue })
            .from(admissionTable)
            .where(
              and(
                eq(admissionTable.schoolId, input.schoolId),
                eq(admissionTable.id, input.admissionId),
              ),
            )
            .limit(1),
          context.db
            .select({ id: schoolSessionTable.id })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.id, input.sessionId),
              ),
            )
            .limit(1),
        ]);
        if (!admission) throw rpcError.notFound('Admission');
        if (!session) throw rpcError.notFound('School session');

        return admissionFinanceDtoSchema.parse({
          ...input,
          values: admission.financeValue[input.sessionId] ?? {},
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateAdmissionFinanceValues: protectedProcedure
    .route({
      summary: 'Update admission finance values',
      description:
        'Replace or remove admission-level pricing overrides for one explicit active academic session while preserving every other session.',
      tags: ['School', 'Billing'],
    })
    .input(updateAdmissionFinanceInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_ADMISSION_FINANCE))
    .output(admissionFinanceDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Lock the session before admission accounts so every later posting
          // command can preserve the same deterministic lock order.
          const [session] = await transaction
            .select({
              financeConfig: schoolSessionTable.financeConfig,
              isActive: schoolSessionTable.isActive,
            })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                eq(schoolSessionTable.id, input.sessionId),
              ),
            )
            .for('update')
            .limit(1);
          if (!session) throw rpcError.notFound('School session');
          const [admission] = await transaction
            .select({
              financeValue: admissionTable.financeValue,
              registered: admissionTable.registered,
            })
            .from(admissionTable)
            .where(
              and(
                eq(admissionTable.schoolId, input.schoolId),
                eq(admissionTable.id, input.admissionId),
              ),
            )
            .for('update')
            .limit(1);
          if (!admission) throw rpcError.notFound('Admission');
          if (!admission.registered) {
            throw rpcError.badRequest(
              'This admission is no longer registered with the school and its pricing cannot be changed.',
            );
          }
          if (!session.isActive) {
            throw rpcError.conflict(
              'Only the active academic session can be updated.',
            );
          }

          validateAdmissionValues(session.financeConfig, input.values);

          const financeValue: StudentFinanceValuesMap = {
            ...admission.financeValue,
          };
          if (Object.keys(input.values).length === 0) {
            delete financeValue[input.sessionId];
          } else {
            financeValue[input.sessionId] = input.values;
          }

          const [updated] = await transaction
            .update(admissionTable)
            .set({ financeValue, updatedAt: new Date() })
            .where(
              and(
                eq(admissionTable.schoolId, input.schoolId),
                eq(admissionTable.id, input.admissionId),
              ),
            )
            .returning({ financeValue: admissionTable.financeValue });
          if (!updated) throw rpcError.notFound('Admission');

          return admissionFinanceDtoSchema.parse({
            schoolId: input.schoolId,
            admissionId: input.admissionId,
            sessionId: input.sessionId,
            values: updated.financeValue[input.sessionId] ?? {},
          });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
